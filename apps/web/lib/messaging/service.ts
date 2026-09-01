import 'server-only';
import { and, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  imChannelMembers,
  imChannels,
  imMentions,
  imMessageReactions,
  imMessages,
  imPins,
  imSavedMessages,
  imUserSettings,
  tenants,
  type ImAction,
  type ImAttachment,
} from '@/lib/db/schema';
import { MessagingForbiddenError, MessagingNotFoundError } from '@/lib/messaging/auth';
import {
  EDIT_WINDOW_MS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_BODY_LENGTH,
  type ImContextType,
  type ImMessageKind,
  type ImSenderKind,
} from '@/lib/messaging/constants';
import type { ImRealtimeEvent } from '@/lib/messaging/events';
import { resolveMentions } from '@/lib/messaging/mentions';
import {
  DELETED_BODY,
  loadPeople,
  loadReactionsFor,
  personMap,
  toMessageDTO,
} from '@/lib/messaging/queries';

/** 403 con un motivo legible. Hereda para que `messagingErrorResponse` lo mapee. */
export class MessagingActionForbiddenError extends MessagingForbiddenError {
  constructor(reason: string) {
    super('viewer', 'admin');
    this.name = 'MessagingActionForbiddenError';
    this.message = reason;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Texto que ve el rail bajo el nombre del canal. */
function previewOf(body: string, kind: ImMessageKind, attachments: ImAttachment[]): string {
  const clean = (body ?? '')
    .replace(/```[\s\S]*?```/g, ' [código] ')
    .replace(/[*_>#`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean) return clean.slice(0, 140);
  if (attachments.length > 0) return `📎 ${attachments.length} adjunto(s)`;
  return kind === 'EVENT' ? 'Nuevo evento' : 'Mensaje';
}

async function clerkOrgIdFor(tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ orgId: tenants.clerkOrganizationId })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row?.orgId ?? null;
}

/** Publicación best-effort. Redis caído nunca puede tirar la persistencia. */
async function publishToUsersSafe(userIds: string[], event: ImRealtimeEvent): Promise<void> {
  if (userIds.length === 0) return;
  try {
    const { publishToUsers } = await import('@/lib/messaging/publisher');
    await publishToUsers(userIds, event);
  } catch (err) {
    console.warn('[messaging] publish falló', {
      kind: event.kind,
      err: (err as Error).message,
    });
  }
}

/** Contadores por canal + totales del usuario, para el evento `unread.changed`. */
async function pushUnreadFor(
  tenantId: string,
  channelId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  try {
    const [perChannel, totals] = await Promise.all([
      db
        .select({
          userId: imChannelMembers.userId,
          unreadCount: imChannelMembers.unreadCount,
          mentionCount: imChannelMembers.mentionCount,
        })
        .from(imChannelMembers)
        .where(
          and(
            eq(imChannelMembers.tenantId, tenantId),
            eq(imChannelMembers.channelId, channelId),
            inArray(imChannelMembers.userId, userIds),
          ),
        ),
      db
        .select({
          userId: imChannelMembers.userId,
          totalUnread: sql<number>`coalesce(sum(${imChannelMembers.unreadCount}), 0)::int`,
          totalMentions: sql<number>`coalesce(sum(${imChannelMembers.mentionCount}), 0)::int`,
        })
        .from(imChannelMembers)
        .where(
          and(
            eq(imChannelMembers.tenantId, tenantId),
            inArray(imChannelMembers.userId, userIds),
            isNull(imChannelMembers.leftAt),
          ),
        )
        .groupBy(imChannelMembers.userId),
    ]);

    const totalsById = new Map(totals.map((t) => [t.userId, t]));

    for (const row of perChannel) {
      const t = totalsById.get(row.userId);
      await publishToUsersSafe([row.userId], {
        kind: 'unread.changed',
        channelId,
        unreadCount: row.unreadCount,
        mentionCount: row.mentionCount,
        totalUnread: Number(t?.totalUnread ?? 0),
        totalMentions: Number(t?.totalMentions ?? 0),
      });
    }
  } catch (err) {
    console.warn('[messaging] no se pudieron publicar contadores', {
      channelId,
      err: (err as Error).message,
    });
  }
}

async function activeMemberIds(tenantId: string, channelId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: imChannelMembers.userId })
    .from(imChannelMembers)
    .where(
      and(
        eq(imChannelMembers.tenantId, tenantId),
        eq(imChannelMembers.channelId, channelId),
        isNull(imChannelMembers.leftAt),
      ),
    );
  return rows.map((r) => r.userId);
}

/**
 * Recalcula el preview del rail. Se llama tras editar o borrar: si se tocó el
 * último mensaje, el sidebar seguiría mostrando texto que ya no existe.
 */
async function refreshChannelPreview(tenantId: string, channelId: string): Promise<void> {
  const [last] = await db
    .select({
      body: imMessages.body,
      kind: imMessages.kind,
      attachments: imMessages.attachments,
      deletedAt: imMessages.deletedAt,
      createdAt: imMessages.createdAt,
    })
    .from(imMessages)
    .where(and(eq(imMessages.tenantId, tenantId), eq(imMessages.channelId, channelId)))
    .orderBy(desc(imMessages.createdAt), desc(imMessages.id))
    .limit(1);

  await db
    .update(imChannels)
    .set({
      lastMessageAt: last?.createdAt ?? null,
      lastMessagePreview: last
        ? last.deletedAt
          ? DELETED_BODY
          : previewOf(last.body, last.kind, last.attachments ?? [])
        : null,
      updatedAt: new Date(),
    })
    .where(and(eq(imChannels.tenantId, tenantId), eq(imChannels.id, channelId)));
}

/** Reacciones agrupadas de un mensaje. */
async function reactionsOf(messageId: string) {
  const map = await loadReactionsFor([messageId]);
  return map.get(messageId) ?? [];
}

async function messageOrThrow(tenantId: string, messageId: string) {
  const [row] = await db
    .select()
    .from(imMessages)
    .where(and(eq(imMessages.tenantId, tenantId), eq(imMessages.id, messageId)))
    .limit(1);
  if (!row) throw new MessagingNotFoundError('Mensaje');
  return row;
}

// ─── El corazón: sendMessage ─────────────────────────────────────────────────

export interface SendMessageInput {
  tenantId: string;
  channelId: string;
  senderUserId?: string | null;
  senderKind?: ImSenderKind;
  kind?: ImMessageKind;
  body: string;
  parentId?: string | null;
  attachments?: ImAttachment[];
  actions?: ImAction[];
  contextType?: ImContextType | null;
  contextId?: string | null;
  contextPayload?: Record<string, unknown>;
  eventKey?: string | null;
  clientNonce?: string | null;
  dedupeKey?: string | null;
  /**
   * Menciones explícitas (las usa el bot: sus tarjetas no llevan `@` en el
   * cuerpo). Se suman a las que se parseen del texto.
   */
  mentionUserIds?: string[];
}

/**
 * Alta de mensaje: persistencia atómica primero, tiempo real después.
 *
 * Idempotente por partida doble — `client_nonce` cubre el reintento del envío
 * optimista del navegador, `dedupe_key` cubre el reintento de un webhook o de
 * un job. Si cualquiera de los dos índices únicos parciales dispara, no se
 * inserta nada y se devuelve el id del mensaje que ya estaba con
 * `created: false`.
 */
export async function sendMessage(input: SendMessageInput): Promise<{
  id: string;
  created: boolean;
}> {
  const body = (input.body ?? '').slice(0, MAX_BODY_LENGTH);
  const attachments = (input.attachments ?? []).slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
  const senderUserId = input.senderUserId ?? null;
  const senderKind: ImSenderKind = input.senderKind ?? (senderUserId ? 'USER' : 'SYSTEM');
  const kind: ImMessageKind = input.kind ?? 'TEXT';

  // Menciones: sólo se parsean del texto de una persona. Un mensaje del bot
  // menciona a quien se le indique explícitamente y a nadie más.
  let mentioned: string[] = [...new Set(input.mentionUserIds ?? [])];
  let everyone = false;
  if (senderKind === 'USER' && body.includes('@')) {
    const orgId = await clerkOrgIdFor(input.tenantId);
    if (orgId) {
      const resolved = await resolveMentions(input.tenantId, orgId, body);
      everyone = resolved.everyone;
      mentioned = [...new Set([...mentioned, ...resolved.userIds])];
    }
  }
  // Uno no se menciona a sí mismo: no genera badge ni entrada en la bandeja.
  const notifyIds = mentioned.filter((id) => id !== senderUserId);

  const inserted = await db.transaction(async (tx) => {
    const [msg] = await tx
      .insert(imMessages)
      .values({
        tenantId: input.tenantId,
        channelId: input.channelId,
        kind,
        senderKind,
        senderUserId,
        body,
        parentId: input.parentId ?? null,
        contextType: input.contextType ?? null,
        contextId: input.contextId ?? null,
        contextPayload: input.contextPayload ?? {},
        attachments,
        actions: input.actions ?? [],
        eventKey: input.eventKey ?? null,
        mentions: mentioned,
        mentionsEveryone: everyone,
        clientNonce: input.clientNonce ?? null,
        dedupeKey: input.dedupeKey ?? null,
      })
      // Sin `target`: cubre a la vez los índices únicos parciales de
      // (channel_id, client_nonce) y (tenant_id, dedupe_key).
      .onConflictDoNothing()
      .returning();

    if (!msg) return null;

    await tx
      .update(imChannels)
      .set({
        lastMessageAt: msg.createdAt,
        lastMessagePreview: previewOf(body, kind, attachments),
        messageCount: sql`${imChannels.messageCount} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(imChannels.tenantId, input.tenantId), eq(imChannels.id, input.channelId)));

    // Fan-out de no leídos: +1 a todos menos al autor.
    await tx
      .update(imChannelMembers)
      .set({ unreadCount: sql`${imChannelMembers.unreadCount} + 1` })
      .where(
        and(
          eq(imChannelMembers.tenantId, input.tenantId),
          eq(imChannelMembers.channelId, input.channelId),
          isNull(imChannelMembers.leftAt),
          ...(senderUserId ? [ne(imChannelMembers.userId, senderUserId)] : []),
        ),
      );

    if (notifyIds.length > 0) {
      await tx
        .update(imChannelMembers)
        .set({ mentionCount: sql`${imChannelMembers.mentionCount} + 1` })
        .where(
          and(
            eq(imChannelMembers.tenantId, input.tenantId),
            eq(imChannelMembers.channelId, input.channelId),
            inArray(imChannelMembers.userId, notifyIds),
            isNull(imChannelMembers.leftAt),
          ),
        );

      await tx
        .insert(imMentions)
        .values(
          notifyIds.map((userId) => ({
            tenantId: input.tenantId,
            messageId: msg.id,
            channelId: input.channelId,
            userId,
          })),
        )
        .onConflictDoNothing();
    }

    if (input.parentId) {
      await tx
        .update(imMessages)
        .set({ replyCount: sql`${imMessages.replyCount} + 1` })
        .where(eq(imMessages.id, input.parentId));
    }

    return msg;
  });

  // Reintento: la fila ya existía. No es un error, es el caso feliz de la
  // idempotencia. Se devuelve el id del mensaje original.
  if (!inserted) {
    const existing = await findExisting(input);
    if (!existing) throw new Error('El mensaje no se pudo guardar');
    return { id: existing, created: false };
  }

  // ── A partir de acá, todo es best-effort ──────────────────────────────────
  try {
    const members = await activeMemberIds(input.tenantId, input.channelId);
    const people = await loadPeople(input.tenantId);
    const dto = toMessageDTO(inserted, { people: personMap(people) });

    await publishToUsersSafe(members, {
      kind: 'message.new',
      channelId: input.channelId,
      message: dto,
    });

    await pushUnreadFor(
      input.tenantId,
      input.channelId,
      members.filter((id) => id !== senderUserId),
    );

    if (notifyIds.length > 0) {
      const [channel] = await db
        .select({
          name: imChannels.name,
          slug: imChannels.slug,
          kind: imChannels.kind,
        })
        .from(imChannels)
        .where(eq(imChannels.id, input.channelId))
        .limit(1);

      await publishToUsersSafe(notifyIds, {
        kind: 'mention.new',
        channelId: input.channelId,
        channelName: channel?.name ?? channel?.slug ?? 'Mensajes',
        messageId: inserted.id,
        body: previewOf(body, kind, attachments),
        senderName: dto.senderName,
      });

      await scheduleMentionEscalations(input.tenantId, inserted.id, notifyIds);
    }
  } catch (err) {
    console.warn('[messaging] fan-out en tiempo real falló', {
      messageId: inserted.id,
      err: (err as Error).message,
    });
  }

  return { id: inserted.id, created: true };
}

/**
 * Programa el aviso por otro canal para las menciones que sigan sin leerse
 * pasado el margen que configuró cada persona.
 *
 * Apagado por defecto (`escalate_mentions_after_minutes` = 0), así que en la
 * práctica no encola nada salvo que alguien lo active a propósito: mal
 * calibrado, esto se vuelve spam y la gente silencia el módulo entero.
 *
 * Best-effort como todo el fan-out: si Redis está caído la mención igual quedó
 * escrita y visible en el panel.
 */
async function scheduleMentionEscalations(
  tenantId: string,
  messageId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  try {
    const prefs = await db
      .select({
        userId: imUserSettings.userId,
        minutes: imUserSettings.escalateMentionsAfterMinutes,
      })
      .from(imUserSettings)
      .where(
        and(
          eq(imUserSettings.tenantId, tenantId),
          inArray(imUserSettings.userId, userIds),
          gt(imUserSettings.escalateMentionsAfterMinutes, 0),
        ),
      );
    if (prefs.length === 0) return;

    const rows = await db
      .select({ id: imMentions.id, userId: imMentions.userId })
      .from(imMentions)
      .where(and(eq(imMentions.messageId, messageId), inArray(imMentions.userId, userIds)));
    const mentionByUser = new Map(rows.map((r) => [r.userId, r.id]));

    const { sendQueueEvent } = await import('@/lib/queue/client');
    for (const p of prefs) {
      const mentionId = mentionByUser.get(p.userId);
      if (!mentionId) continue;
      await sendQueueEvent(
        'im-mention-escalate',
        { tenantId, mentionId },
        { delayMs: p.minutes * 60_000 },
      );
    }
  } catch (err) {
    console.warn('[messaging] no se pudo programar el escalado de menciones', {
      messageId,
      err: (err as Error).message,
    });
  }
}

/** Recupera el id del mensaje que ganó la carrera de idempotencia. */
async function findExisting(input: SendMessageInput): Promise<string | null> {
  if (input.clientNonce) {
    const [row] = await db
      .select({ id: imMessages.id })
      .from(imMessages)
      .where(
        and(
          eq(imMessages.channelId, input.channelId),
          eq(imMessages.clientNonce, input.clientNonce),
        ),
      )
      .limit(1);
    if (row) return row.id;
  }
  if (input.dedupeKey) {
    const [row] = await db
      .select({ id: imMessages.id })
      .from(imMessages)
      .where(
        and(eq(imMessages.tenantId, input.tenantId), eq(imMessages.dedupeKey, input.dedupeKey)),
      )
      .limit(1);
    if (row) return row.id;
  }
  return null;
}

// ─── Edición y borrado ───────────────────────────────────────────────────────

/** Sólo el autor, y sólo dentro de la ventana de `EDIT_WINDOW_MS`. */
export async function editMessage(a: {
  tenantId: string;
  messageId: string;
  userId: string;
  body: string;
}): Promise<void> {
  const row = await messageOrThrow(a.tenantId, a.messageId);

  if (row.deletedAt) throw new MessagingActionForbiddenError('El mensaje ya fue eliminado');
  if (row.senderUserId !== a.userId) {
    throw new MessagingActionForbiddenError('Sólo el autor puede editar su mensaje');
  }
  if (Date.now() - row.createdAt.getTime() > EDIT_WINDOW_MS) {
    throw new MessagingActionForbiddenError('Pasó la ventana de edición de este mensaje');
  }

  const body = (a.body ?? '').slice(0, MAX_BODY_LENGTH);
  const [updated] = await db
    .update(imMessages)
    .set({ body, editedAt: new Date() })
    .where(and(eq(imMessages.tenantId, a.tenantId), eq(imMessages.id, a.messageId)))
    .returning();

  if (!updated) return;
  await refreshChannelPreview(a.tenantId, row.channelId);

  try {
    const [members, people, reactions] = await Promise.all([
      activeMemberIds(a.tenantId, row.channelId),
      loadPeople(a.tenantId),
      reactionsOf(a.messageId),
    ]);
    await publishToUsersSafe(members, {
      kind: 'message.updated',
      channelId: row.channelId,
      message: toMessageDTO(updated, { people: personMap(people), reactions }),
    });
  } catch (err) {
    console.warn('[messaging] publish de edición falló', {
      err: (err as Error).message,
    });
  }
}

/**
 * Borrado **blando**: queda la lápida. En un producto con datos clínicos el
 * borrado duro rompe la trazabilidad; el borrado real lo hace retención.
 */
export async function deleteMessage(a: {
  tenantId: string;
  messageId: string;
  userId: string;
  isAdmin: boolean;
}): Promise<void> {
  const row = await messageOrThrow(a.tenantId, a.messageId);
  if (row.deletedAt) return;
  if (row.senderUserId !== a.userId && !a.isAdmin) {
    throw new MessagingActionForbiddenError('Sólo el autor o un administrador puede eliminarlo');
  }

  await db
    .update(imMessages)
    .set({ deletedAt: new Date(), deletedByUserId: a.userId })
    .where(and(eq(imMessages.tenantId, a.tenantId), eq(imMessages.id, a.messageId)));

  await refreshChannelPreview(a.tenantId, row.channelId);

  const members = await activeMemberIds(a.tenantId, row.channelId);
  await publishToUsersSafe(members, {
    kind: 'message.deleted',
    channelId: row.channelId,
    messageId: a.messageId,
  });
}

// ─── Reacciones, pines y guardados ───────────────────────────────────────────

/** Alterna la reacción del usuario. Sin fila previa, la crea. */
export async function toggleReaction(a: {
  tenantId: string;
  messageId: string;
  userId: string;
  emoji: string;
}): Promise<void> {
  const row = await messageOrThrow(a.tenantId, a.messageId);
  const emoji = a.emoji.trim().slice(0, 16);
  if (!emoji) return;

  const removed = await db
    .delete(imMessageReactions)
    .where(
      and(
        eq(imMessageReactions.messageId, a.messageId),
        eq(imMessageReactions.userId, a.userId),
        eq(imMessageReactions.emoji, emoji),
      ),
    )
    .returning({ emoji: imMessageReactions.emoji });

  if (removed.length === 0) {
    await db
      .insert(imMessageReactions)
      .values({
        messageId: a.messageId,
        userId: a.userId,
        tenantId: a.tenantId,
        emoji,
      })
      .onConflictDoNothing();
  }

  const members = await activeMemberIds(a.tenantId, row.channelId);
  await publishToUsersSafe(members, {
    kind: 'reaction.changed',
    channelId: row.channelId,
    messageId: a.messageId,
    reactions: await reactionsOf(a.messageId),
  });
}

/** Fija o desfija el mensaje en su canal. El pin es del canal, no del usuario. */
export async function togglePin(a: {
  tenantId: string;
  channelId: string;
  messageId: string;
  userId: string;
}): Promise<void> {
  await messageOrThrow(a.tenantId, a.messageId);

  const inserted = await db
    .insert(imPins)
    .values({
      channelId: a.channelId,
      messageId: a.messageId,
      tenantId: a.tenantId,
      pinnedByUserId: a.userId,
    })
    .onConflictDoNothing()
    .returning({ messageId: imPins.messageId });

  const pinned = inserted.length > 0;
  if (!pinned) {
    await db
      .delete(imPins)
      .where(
        and(
          eq(imPins.tenantId, a.tenantId),
          eq(imPins.channelId, a.channelId),
          eq(imPins.messageId, a.messageId),
        ),
      );
  }

  const members = await activeMemberIds(a.tenantId, a.channelId);
  await publishToUsersSafe(members, {
    kind: 'channel.updated',
    channelId: a.channelId,
  });
}

/** Guardado personal ("para después"). No lo ve nadie más. */
export async function toggleSaved(a: {
  tenantId: string;
  messageId: string;
  userId: string;
}): Promise<void> {
  await messageOrThrow(a.tenantId, a.messageId);

  const inserted = await db
    .insert(imSavedMessages)
    .values({ messageId: a.messageId, userId: a.userId, tenantId: a.tenantId })
    .onConflictDoNothing()
    .returning({ messageId: imSavedMessages.messageId });

  if (inserted.length === 0) {
    await db
      .delete(imSavedMessages)
      .where(
        and(
          eq(imSavedMessages.messageId, a.messageId),
          eq(imSavedMessages.userId, a.userId),
          eq(imSavedMessages.tenantId, a.tenantId),
        ),
      );
  }
}

// ─── Lectura y menciones ─────────────────────────────────────────────────────

/**
 * Marca el canal como leído: contadores a cero y menciones del canal marcadas
 * como vistas. Publica los totales nuevos para que el badge del sidebar baje
 * sin recargar.
 */
export async function markRead(a: {
  tenantId: string;
  channelId: string;
  userId: string;
  upToMessageId?: string | null;
}): Promise<void> {
  const now = new Date();

  await db
    .update(imChannelMembers)
    .set({
      unreadCount: 0,
      mentionCount: 0,
      lastReadAt: now,
      ...(a.upToMessageId ? { lastReadMessageId: a.upToMessageId } : {}),
    })
    .where(
      and(
        eq(imChannelMembers.tenantId, a.tenantId),
        eq(imChannelMembers.channelId, a.channelId),
        eq(imChannelMembers.userId, a.userId),
      ),
    );

  await db
    .update(imMentions)
    .set({ readAt: now })
    .where(
      and(
        eq(imMentions.tenantId, a.tenantId),
        eq(imMentions.channelId, a.channelId),
        eq(imMentions.userId, a.userId),
        isNull(imMentions.readAt),
      ),
    );

  await pushUnreadFor(a.tenantId, a.channelId, [a.userId]);
}

/** "Ya lo atendí", sin tener que responder. */
export async function resolveMention(a: {
  tenantId: string;
  mentionId: string;
  userId: string;
}): Promise<void> {
  const now = new Date();
  const [row] = await db
    .update(imMentions)
    .set({
      resolvedAt: now,
      readAt: sql`coalesce(${imMentions.readAt}, now())`,
    })
    .where(
      and(
        eq(imMentions.tenantId, a.tenantId),
        eq(imMentions.id, a.mentionId),
        eq(imMentions.userId, a.userId),
      ),
    )
    .returning({ channelId: imMentions.channelId });

  if (!row) throw new MessagingNotFoundError('Mención');
  await pushUnreadFor(a.tenantId, row.channelId, [a.userId]);
}
