'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

import { db } from '@/lib/db/client';
import {
  auditLogs,
  users,
  whatsappConnections,
  whatsappContacts,
  whatsappConversations,
  whatsappMessages,
} from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';
import { buildConnector } from '@/lib/whatsapp';
import { auth } from '@clerk/nextjs/server';

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

function ok<T>(data: T): ActionResult<T> {
  return { success: true, data };
}
function fail<T>(error: string, fieldErrors?: Record<string, string[]>): ActionResult<T> {
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

// ─── Send manual message ────────────────────────────────────────────────

const sendSchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string().min(1).max(4096),
  clientNonce: z.string().uuid().optional(),
  takeoverHours: z.number().int().min(0).max(72).default(2),
});

export async function sendManualMessage(input: unknown): Promise<ActionResult<{ messageId: string }>> {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) {
    return fail('Datos inválidos', parsed.error.flatten().fieldErrors);
  }
  const { tenant } = await getCurrentTenant();
  const senderUserId = await getInternalUserId();

  // Cargar conversación + contacto.
  const convRows = await db
    .select({
      conv: whatsappConversations,
      contact: whatsappContacts,
    })
    .from(whatsappConversations)
    .innerJoin(whatsappContacts, eq(whatsappContacts.id, whatsappConversations.contactId))
    .where(
      and(
        eq(whatsappConversations.id, parsed.data.conversationId),
        eq(whatsappConversations.tenantId, tenant.id),
      ),
    )
    .limit(1);
  const row = convRows[0];
  if (!row) return fail('Conversación no encontrada');

  // Cargar conexión según channel.
  const mode = row.conv.channel === 'WHATSAPP_CLOUD' ? 'CLOUD' : 'EVOLUTION';
  const connRows = await db
    .select()
    .from(whatsappConnections)
    .where(and(eq(whatsappConnections.tenantId, tenant.id), eq(whatsappConnections.mode, mode)))
    .limit(1);
  const conn = connRows[0];
  if (!conn || conn.status !== 'CONNECTED') {
    return fail(`La conexión WhatsApp (${mode}) no está disponible`);
  }

  const clientNonce = parsed.data.clientNonce ?? randomUUID();

  // Insertar mensaje en PENDING (idempotente por client_nonce).
  const [pending] = await db
    .insert(whatsappMessages)
    .values({
      tenantId: tenant.id,
      conversationId: row.conv.id,
      direction: 'OUTBOUND',
      type: 'TEXT',
      senderType: 'HUMAN',
      senderUserId,
      deliveryStatus: 'PENDING',
      contentText: parsed.data.text,
      clientNonce,
    })
    .onConflictDoNothing({
      target: [whatsappMessages.conversationId, whatsappMessages.clientNonce],
    })
    .returning();

  // Si onConflict no devolvió fila (re-submit), buscar existente.
  const messageRow =
    pending ??
    (
      await db
        .select()
        .from(whatsappMessages)
        .where(
          and(
            eq(whatsappMessages.conversationId, row.conv.id),
            eq(whatsappMessages.clientNonce, clientNonce),
          ),
        )
        .limit(1)
    )[0];
  if (!messageRow) return fail('No se pudo registrar el mensaje');

  // Si ya estaba SENT, devolver idempotente.
  if (messageRow.deliveryStatus === 'SENT' || messageRow.deliveryStatus === 'DELIVERED') {
    return ok({ messageId: messageRow.id });
  }

  // Despachar al provider.
  try {
    const connector = buildConnector(conn);
    const result = await connector.sendText(row.contact.phoneE164, parsed.data.text);
    await db
      .update(whatsappMessages)
      .set({
        deliveryStatus: 'SENT',
        externalId: result.id,
      })
      .where(eq(whatsappMessages.id, messageRow.id));
  } catch (err) {
    const msg = (err as Error).message;
    await db
      .update(whatsappMessages)
      .set({ deliveryStatus: 'FAILED', failureReason: msg.slice(0, 500) })
      .where(eq(whatsappMessages.id, messageRow.id));
    return fail(`Error al enviar: ${msg}`);
  }

  // Takeover automático: si el operador escribe, marcamos HANDOFF por N horas.
  if (parsed.data.takeoverHours > 0) {
    const until = new Date(Date.now() + parsed.data.takeoverHours * 3600_000);
    await db
      .update(whatsappConversations)
      .set({
        status: 'HANDOFF',
        assignedUserId: senderUserId,
        humanTakeoverAt: row.conv.humanTakeoverAt ?? new Date(),
        humanTakeoverUntil: until,
        lastHumanMsgAt: new Date(),
        lastMsgAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(whatsappConversations.id, row.conv.id));
  } else {
    await db
      .update(whatsappConversations)
      .set({ lastHumanMsgAt: new Date(), lastMsgAt: new Date(), updatedAt: new Date() })
      .where(eq(whatsappConversations.id, row.conv.id));
  }

  try {
    await db.insert(auditLogs).values({
      tenantId: tenant.id,
      actorUserId: senderUserId,
      action: 'wa_message_sent_manual',
      entity: 'whatsapp_message',
      entityId: messageRow.id,
      after: { conversationId: row.conv.id, length: parsed.data.text.length } as never,
    });
  } catch (auditErr) {
    console.error('audit_failed', auditErr);
  }

  revalidatePath(`/dashboard/whatsapp/${row.conv.id}`);
  revalidatePath('/dashboard/whatsapp');
  return ok({ messageId: messageRow.id });
}

// ─── Takeover / release / close ───────────────────────────────────────────

const takeoverSchema = z.object({
  conversationId: z.string().uuid(),
  hours: z.number().int().min(1).max(72).default(2),
});

export async function takeoverConversation(input: unknown): Promise<ActionResult<null>> {
  const parsed = takeoverSchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos', parsed.error.flatten().fieldErrors);
  const { tenant } = await getCurrentTenant();
  const senderUserId = await getInternalUserId();
  const until = new Date(Date.now() + parsed.data.hours * 3600_000);

  await db
    .update(whatsappConversations)
    .set({
      status: 'HANDOFF',
      assignedUserId: senderUserId,
      humanTakeoverAt: new Date(),
      humanTakeoverUntil: until,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsappConversations.id, parsed.data.conversationId),
        eq(whatsappConversations.tenantId, tenant.id),
      ),
    );

  revalidatePath(`/dashboard/whatsapp/${parsed.data.conversationId}`);
  revalidatePath('/dashboard/whatsapp');
  return ok(null);
}

const conversationIdSchema = z.object({ conversationId: z.string().uuid() });

export async function releaseConversation(input: unknown): Promise<ActionResult<null>> {
  const parsed = conversationIdSchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos');
  const { tenant } = await getCurrentTenant();
  await db
    .update(whatsappConversations)
    .set({
      status: 'ACTIVE',
      assignedUserId: null,
      humanTakeoverUntil: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsappConversations.id, parsed.data.conversationId),
        eq(whatsappConversations.tenantId, tenant.id),
      ),
    );
  revalidatePath(`/dashboard/whatsapp/${parsed.data.conversationId}`);
  revalidatePath('/dashboard/whatsapp');
  return ok(null);
}

export async function closeConversation(input: unknown): Promise<ActionResult<null>> {
  const parsed = conversationIdSchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos');
  const { tenant } = await getCurrentTenant();
  await db
    .update(whatsappConversations)
    .set({ status: 'CLOSED', updatedAt: new Date() })
    .where(
      and(
        eq(whatsappConversations.id, parsed.data.conversationId),
        eq(whatsappConversations.tenantId, tenant.id),
      ),
    );
  revalidatePath(`/dashboard/whatsapp/${parsed.data.conversationId}`);
  revalidatePath('/dashboard/whatsapp');
  return ok(null);
}

export async function toggleUrgent(input: unknown): Promise<ActionResult<null>> {
  const parsed = conversationIdSchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos');
  const { tenant } = await getCurrentTenant();

  const rows = await db
    .select({ urgentFlag: whatsappConversations.urgentFlag })
    .from(whatsappConversations)
    .where(
      and(
        eq(whatsappConversations.id, parsed.data.conversationId),
        eq(whatsappConversations.tenantId, tenant.id),
      ),
    )
    .limit(1);
  const current = rows[0];
  if (!current) return fail('Conversación no encontrada');

  await db
    .update(whatsappConversations)
    .set({ urgentFlag: !current.urgentFlag, updatedAt: new Date() })
    .where(eq(whatsappConversations.id, parsed.data.conversationId));

  revalidatePath(`/dashboard/whatsapp/${parsed.data.conversationId}`);
  revalidatePath('/dashboard/whatsapp');
  return ok(null);
}
