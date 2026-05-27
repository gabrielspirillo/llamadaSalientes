'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, desc, eq, ilike } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import {
  auditLogs,
  users,
  whatsappConnections,
  whatsappContacts,
  whatsappConversations,
  whatsappConversationTags,
  whatsappMessages,
  whatsappQuickReplies,
  whatsappTags,
} from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';
import { listTenantMembersSynced, userIsTenantMember } from '@/lib/tenant-members';
import { auth } from '@clerk/nextjs/server';
import { buildConnector } from '@/lib/whatsapp';
import { buildWhatsappMediaPath, mediaUpload } from '@/lib/storage/media';

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

function ok<T>(data: T): ActionResult<T> {
  return { success: true, data };
}
function fail<T = never>(error: string, fieldErrors?: Record<string, string[]>): ActionResult<T> {
  return { success: false, error, fieldErrors };
}

async function getInternalUserId(): Promise<string | null> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return null;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function assertConversationInTenant(tenantId: string, conversationId: string) {
  const rows = await db
    .select({ id: whatsappConversations.id })
    .from(whatsappConversations)
    .where(
      and(
        eq(whatsappConversations.id, conversationId),
        eq(whatsappConversations.tenantId, tenantId),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

function revalidate(conversationId: string) {
  revalidatePath(`/dashboard/whatsapp/${conversationId}`);
  revalidatePath('/dashboard/whatsapp');
}

// ─── Internal notes ───────────────────────────────────────────────────────

const noteSchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string().min(1).max(4096),
});

export async function addInternalNote(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos', parsed.error.flatten().fieldErrors);
  const { tenant } = await getCurrentTenant();
  const senderUserId = await getInternalUserId();
  if (!(await assertConversationInTenant(tenant.id, parsed.data.conversationId))) {
    return fail('Conversación no encontrada');
  }
  const [row] = await db
    .insert(whatsappMessages)
    .values({
      tenantId: tenant.id,
      conversationId: parsed.data.conversationId,
      direction: 'OUTBOUND',
      type: 'TEXT',
      senderType: 'HUMAN',
      senderUserId,
      internalNote: true,
      contentText: parsed.data.text,
      clientNonce: randomUUID(),
    })
    .returning({ id: whatsappMessages.id });

  await db
    .update(whatsappConversations)
    .set({ updatedAt: new Date() })
    .where(eq(whatsappConversations.id, parsed.data.conversationId));

  revalidate(parsed.data.conversationId);
  return ok({ id: row!.id });
}

// ─── AI agent toggle ─────────────────────────────────────────────────────

const aiSchema = z.object({
  conversationId: z.string().uuid(),
  enabled: z.boolean(),
});

export async function setAiEnabled(input: unknown): Promise<ActionResult<null>> {
  const parsed = aiSchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos');
  const { tenant } = await getCurrentTenant();
  const actorUserId = await getInternalUserId();

  // Al encender el bot, además sacamos la conversación del estado HANDOFF
  // y limpiamos el takeover humano: el switch es el único control para
  // devolver el control al agente.
  const patch = parsed.data.enabled
    ? {
        aiEnabled: true,
        status: 'ACTIVE' as const,
        assignedUserId: null,
        humanTakeoverUntil: null,
        updatedAt: new Date(),
      }
    : { aiEnabled: false, updatedAt: new Date() };

  const updated = await db
    .update(whatsappConversations)
    .set(patch)
    .where(
      and(
        eq(whatsappConversations.id, parsed.data.conversationId),
        eq(whatsappConversations.tenantId, tenant.id),
      ),
    )
    .returning({ id: whatsappConversations.id });
  if (updated.length === 0) return fail('Conversación no encontrada');

  try {
    await db.insert(auditLogs).values({
      tenantId: tenant.id,
      actorUserId,
      action: parsed.data.enabled ? 'wa_ai_resumed' : 'wa_ai_paused',
      entity: 'whatsapp_conversation',
      entityId: parsed.data.conversationId,
      after: { aiEnabled: parsed.data.enabled } as never,
    });
  } catch (err) {
    console.error('audit_failed', err);
  }

  revalidate(parsed.data.conversationId);
  return ok(null);
}

// ─── Assignment ─────────────────────────────────────────────────────────

const assignSchema = z.object({
  conversationId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
});

export async function assignConversation(input: unknown): Promise<ActionResult<null>> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos');
  const { tenant } = await getCurrentTenant();
  const actorUserId = await getInternalUserId();

  if (parsed.data.userId) {
    const isMember = await userIsTenantMember(
      tenant.id,
      tenant.clerkOrganizationId,
      parsed.data.userId,
    );
    if (!isMember) return fail('El usuario no pertenece al tenant');
  }

  const updated = await db
    .update(whatsappConversations)
    .set({ assignedUserId: parsed.data.userId, updatedAt: new Date() })
    .where(
      and(
        eq(whatsappConversations.id, parsed.data.conversationId),
        eq(whatsappConversations.tenantId, tenant.id),
      ),
    )
    .returning({ id: whatsappConversations.id });
  if (updated.length === 0) return fail('Conversación no encontrada');

  try {
    await db.insert(auditLogs).values({
      tenantId: tenant.id,
      actorUserId,
      action: 'wa_conversation_assigned',
      entity: 'whatsapp_conversation',
      entityId: parsed.data.conversationId,
      after: { assignedUserId: parsed.data.userId } as never,
    });
  } catch (err) {
    console.error('audit_failed', err);
  }

  revalidate(parsed.data.conversationId);
  return ok(null);
}

// ─── Tags ───────────────────────────────────────────────────────────────

const colorRe = /^#[0-9a-fA-F]{6}$/;
const tagCreateSchema = z.object({
  label: z.string().min(1).max(40),
  color: z.string().regex(colorRe).default('#71717a'),
});

export async function createTag(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = tagCreateSchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos', parsed.error.flatten().fieldErrors);
  const { tenant } = await getCurrentTenant();
  try {
    const [row] = await db
      .insert(whatsappTags)
      .values({ tenantId: tenant.id, label: parsed.data.label, color: parsed.data.color })
      .returning({ id: whatsappTags.id });
    revalidatePath('/dashboard/whatsapp');
    return ok({ id: row!.id });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('whatsapp_tags_tenant_label_unique')) {
      return fail('Ya existe una etiqueta con ese nombre');
    }
    return fail(msg);
  }
}

const tagAssignSchema = z.object({
  conversationId: z.string().uuid(),
  tagId: z.string().uuid(),
});

export async function addTagToConversation(input: unknown): Promise<ActionResult<null>> {
  const parsed = tagAssignSchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos');
  const { tenant } = await getCurrentTenant();
  if (!(await assertConversationInTenant(tenant.id, parsed.data.conversationId))) {
    return fail('Conversación no encontrada');
  }
  const tagRows = await db
    .select({ id: whatsappTags.id })
    .from(whatsappTags)
    .where(and(eq(whatsappTags.id, parsed.data.tagId), eq(whatsappTags.tenantId, tenant.id)))
    .limit(1);
  if (tagRows.length === 0) return fail('Etiqueta no encontrada');

  await db
    .insert(whatsappConversationTags)
    .values({
      conversationId: parsed.data.conversationId,
      tagId: parsed.data.tagId,
    })
    .onConflictDoNothing();
  revalidate(parsed.data.conversationId);
  return ok(null);
}

export async function removeTagFromConversation(input: unknown): Promise<ActionResult<null>> {
  const parsed = tagAssignSchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos');
  const { tenant } = await getCurrentTenant();
  if (!(await assertConversationInTenant(tenant.id, parsed.data.conversationId))) {
    return fail('Conversación no encontrada');
  }
  await db
    .delete(whatsappConversationTags)
    .where(
      and(
        eq(whatsappConversationTags.conversationId, parsed.data.conversationId),
        eq(whatsappConversationTags.tagId, parsed.data.tagId),
      ),
    );
  revalidate(parsed.data.conversationId);
  return ok(null);
}

// ─── Quick replies ──────────────────────────────────────────────────────

const quickReplySchema = z.object({
  shortcut: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9_-]+$/i, 'Solo letras, números, guion y guion bajo'),
  text: z.string().min(1).max(4096),
});

export async function createQuickReply(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = quickReplySchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos', parsed.error.flatten().fieldErrors);
  const { tenant } = await getCurrentTenant();
  try {
    const [row] = await db
      .insert(whatsappQuickReplies)
      .values({ tenantId: tenant.id, shortcut: parsed.data.shortcut, text: parsed.data.text })
      .returning({ id: whatsappQuickReplies.id });
    revalidatePath('/dashboard/whatsapp/quick-replies');
    return ok({ id: row!.id });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('whatsapp_quick_replies_tenant_shortcut_unique')) {
      return fail('Ya existe una respuesta con ese atajo');
    }
    return fail(msg);
  }
}

const updateQuickReplySchema = quickReplySchema.extend({ id: z.string().uuid() });

export async function updateQuickReply(input: unknown): Promise<ActionResult<null>> {
  const parsed = updateQuickReplySchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos', parsed.error.flatten().fieldErrors);
  const { tenant } = await getCurrentTenant();
  const updated = await db
    .update(whatsappQuickReplies)
    .set({ shortcut: parsed.data.shortcut, text: parsed.data.text, updatedAt: new Date() })
    .where(
      and(eq(whatsappQuickReplies.id, parsed.data.id), eq(whatsappQuickReplies.tenantId, tenant.id)),
    )
    .returning({ id: whatsappQuickReplies.id });
  if (updated.length === 0) return fail('Respuesta no encontrada');
  revalidatePath('/dashboard/whatsapp/quick-replies');
  return ok(null);
}

export async function deleteQuickReply(input: unknown): Promise<ActionResult<null>> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return fail('Datos inválidos');
  const { tenant } = await getCurrentTenant();
  await db
    .delete(whatsappQuickReplies)
    .where(
      and(eq(whatsappQuickReplies.id, parsed.data.id), eq(whatsappQuickReplies.tenantId, tenant.id)),
    );
  revalidatePath('/dashboard/whatsapp/quick-replies');
  return ok(null);
}

// Búsqueda usada por el popup "/" del composer.
export async function searchQuickReplies(query: string): Promise<
  ActionResult<Array<{ id: string; shortcut: string; text: string }>>
> {
  const { tenant } = await getCurrentTenant();
  const q = (query ?? '').trim().slice(0, 32);
  const where = q
    ? and(eq(whatsappQuickReplies.tenantId, tenant.id), ilike(whatsappQuickReplies.shortcut, `${q}%`))
    : eq(whatsappQuickReplies.tenantId, tenant.id);
  const rows = await db
    .select({
      id: whatsappQuickReplies.id,
      shortcut: whatsappQuickReplies.shortcut,
      text: whatsappQuickReplies.text,
    })
    .from(whatsappQuickReplies)
    .where(where)
    .orderBy(asc(whatsappQuickReplies.shortcut))
    .limit(10);
  return ok(rows);
}

// ─── Media upload + send ────────────────────────────────────────────────

const MEDIA_KINDS = ['image', 'audio', 'video', 'document'] as const;
type MediaKind = (typeof MEDIA_KINDS)[number];

const MAX_BYTES: Record<MediaKind, number> = {
  image: 5 * 1024 * 1024, // 5 MB
  audio: 16 * 1024 * 1024, // 16 MB
  video: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

// Whitelists alineados con lo que acepta WhatsApp (Cloud / Twilio / Evolution).
// Fuente: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
// IMPORTANTE: webm NO está aceptado para audio; el MediaRecorder de Chrome
// produce audio/webm por default — el cliente debe transcodificar a mp3
// antes de subir.
const AUDIO_MIMES = new Set([
  'audio/aac',
  'audio/amr',
  'audio/mp4',
  'audio/m4a',
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/aac',
  'audio/amr',
]);
const IMAGE_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/3gpp']);
const DOCUMENT_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
]);

function normalizeMime(mime: string): string {
  // El charset (";boundary=...") y los codecs sufijo se conservan en el `;`.
  // Comparamos sin parámetros para audio/ogg;codecs=opus, etc.
  return mime.trim().toLowerCase();
}

function detectKind(mime: string): MediaKind | null {
  const m = normalizeMime(mime);
  const base = m.split(';')[0] ?? m;
  if (AUDIO_MIMES.has(m) || AUDIO_MIMES.has(base)) return 'audio';
  if (IMAGE_MIMES.has(base)) return 'image';
  if (VIDEO_MIMES.has(base)) return 'video';
  if (DOCUMENT_MIMES.has(base)) return 'document';
  return null;
}

export async function sendMediaMessage(formData: FormData): Promise<ActionResult<{ messageId: string }>> {
  const conversationId = String(formData.get('conversationId') ?? '');
  const caption = String(formData.get('caption') ?? '').slice(0, 1024) || undefined;
  const file = formData.get('file');

  if (!conversationId || !file || !(file instanceof File)) {
    return fail('Falta archivo o conversación');
  }
  if (!z.string().uuid().safeParse(conversationId).success) {
    return fail('conversationId inválido');
  }
  const mime = file.type || 'application/octet-stream';
  const kind = detectKind(mime);
  if (!kind) {
    // Mensaje extra-específico para el caso del MediaRecorder de Chrome.
    if (mime.startsWith('audio/webm')) {
      return fail(
        'WhatsApp no acepta audio/webm. Tu navegador debió convertir el audio a MP3 antes de subir; recarga la página y reintenta.',
      );
    }
    return fail(`Tipo de archivo no soportado: ${mime}`);
  }

  if (file.size > MAX_BYTES[kind]) {
    const mb = Math.round(MAX_BYTES[kind] / (1024 * 1024));
    return fail(`Archivo demasiado grande. Máximo ${mb} MB para ${kind}.`);
  }

  const { tenant } = await getCurrentTenant();
  const senderUserId = await getInternalUserId();

  // Cargar conversación + contacto + conexión.
  const convRows = await db
    .select({
      conv: whatsappConversations,
      contact: whatsappContacts,
    })
    .from(whatsappConversations)
    .innerJoin(whatsappContacts, eq(whatsappContacts.id, whatsappConversations.contactId))
    .where(
      and(eq(whatsappConversations.id, conversationId), eq(whatsappConversations.tenantId, tenant.id)),
    )
    .limit(1);
  const row = convRows[0];
  if (!row) return fail('Conversación no encontrada');
  if (row.conv.status === 'CLOSED') return fail('La conversación está cerrada');

  const mode =
    row.conv.channel === 'WHATSAPP_CLOUD'
      ? ('CLOUD' as const)
      : row.conv.channel === 'WHATSAPP_TWILIO'
        ? ('TWILIO' as const)
        : ('EVOLUTION' as const);
  const connRows = await db
    .select()
    .from(whatsappConnections)
    .where(and(eq(whatsappConnections.tenantId, tenant.id), eq(whatsappConnections.mode, mode)))
    .limit(1);
  const conn = connRows[0];
  if (!conn || conn.status !== 'CONNECTED') {
    return fail(`La conexión WhatsApp (${mode}) no está disponible`);
  }

  // Subir al bucket S3/MinIO (bucket público whatsapp-media).
  let buf = Buffer.from(await file.arrayBuffer());
  let uploadMime = mime;
  let ext = (file.name?.split('.').pop() ?? '').toLowerCase() || 'bin';

  // Convertir audio a OGG Opus para que WhatsApp lo muestre como nota de voz.
  if (kind === 'audio') {
    try {
      const { toVoiceNote } = await import('@/lib/audio/to-voice-note');
      buf = await toVoiceNote(buf, mime);
      uploadMime = 'audio/ogg; codecs=opus';
      ext = 'ogg';
    } catch (err) {
      console.error('[sendMediaMessage] ffmpeg conversion failed, sending as-is', err);
    }
  }

  const path = buildWhatsappMediaPath(tenant.id, row.conv.id, ext);
  const { publicUrl } = await mediaUpload({ path, body: buf, contentType: uploadMime });
  const mediaUrl = publicUrl;

  const clientNonce = randomUUID();
  const typeMap: Record<MediaKind, 'IMAGE' | 'AUDIO' | 'VIDEO' | 'PDF'> = {
    image: 'IMAGE',
    audio: 'AUDIO',
    video: 'VIDEO',
    document: 'PDF',
  };

  const [pending] = await db
    .insert(whatsappMessages)
    .values({
      tenantId: tenant.id,
      conversationId: row.conv.id,
      direction: 'OUTBOUND',
      type: typeMap[kind],
      senderType: 'HUMAN',
      senderUserId,
      deliveryStatus: 'PENDING',
      contentText: caption ?? null,
      mediaUrl,
      mediaType: uploadMime,
      clientNonce,
    })
    .returning();
  if (!pending) return fail('No se pudo registrar el mensaje');

  try {
    const connector = buildConnector(conn);
    const result = await connector.sendMedia(row.contact.phoneE164, kind, mediaUrl, {
      caption,
      filename: file.name || undefined,
    });
    await db
      .update(whatsappMessages)
      .set({ deliveryStatus: 'SENT', externalId: result.id })
      .where(eq(whatsappMessages.id, pending.id));
  } catch (err) {
    const msg = (err as Error).message;
    await db
      .update(whatsappMessages)
      .set({ deliveryStatus: 'FAILED', failureReason: msg.slice(0, 500) })
      .where(eq(whatsappMessages.id, pending.id));
    return fail(`Error al enviar: ${msg}`);
  }

  // Auto-handoff 2 h (igual que mensajes de texto).
  await db
    .update(whatsappConversations)
    .set({
      status: 'HANDOFF',
      assignedUserId: senderUserId,
      humanTakeoverAt: row.conv.humanTakeoverAt ?? new Date(),
      humanTakeoverUntil: new Date(Date.now() + 2 * 3600_000),
      lastHumanMsgAt: new Date(),
      lastMsgAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(whatsappConversations.id, row.conv.id));

  revalidate(row.conv.id);
  return ok({ messageId: pending.id });
}

// ─── Read-only helpers consumidos por server components ────────────────

export async function listTenantMembersForAssign(): Promise<
  ActionResult<Array<{ userId: string; email: string; role: string }>>
> {
  const { tenant } = await getCurrentTenant();
  const members = await listTenantMembersSynced(tenant.id, tenant.clerkOrganizationId);
  return ok(members.map(({ userId, email, role }) => ({ userId, email, role })));
}

export async function listTagsForTenant(): Promise<
  ActionResult<Array<{ id: string; label: string; color: string }>>
> {
  const { tenant } = await getCurrentTenant();
  const rows = await db
    .select({ id: whatsappTags.id, label: whatsappTags.label, color: whatsappTags.color })
    .from(whatsappTags)
    .where(eq(whatsappTags.tenantId, tenant.id))
    .orderBy(asc(whatsappTags.label));
  return ok(rows);
}

export async function listQuickRepliesAll(): Promise<
  ActionResult<
    Array<{ id: string; shortcut: string; text: string; updatedAt: Date }>
  >
> {
  const { tenant } = await getCurrentTenant();
  const rows = await db
    .select({
      id: whatsappQuickReplies.id,
      shortcut: whatsappQuickReplies.shortcut,
      text: whatsappQuickReplies.text,
      updatedAt: whatsappQuickReplies.updatedAt,
    })
    .from(whatsappQuickReplies)
    .where(eq(whatsappQuickReplies.tenantId, tenant.id))
    .orderBy(desc(whatsappQuickReplies.updatedAt));
  return ok(rows);
}
