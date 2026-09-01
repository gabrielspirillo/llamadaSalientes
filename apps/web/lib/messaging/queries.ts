import 'server-only';
import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  imChannelMembers,
  imChannels,
  imMentions,
  imMessageReactions,
  imMessages,
  imPins,
  imSavedMessages,
  tenants,
  users,
} from '@/lib/db/schema';
import { THREAD_PAGE_SIZE, isImTone } from '@/lib/messaging/constants';
import type {
  ImChannelDTO,
  ImMentionDTO,
  ImMessageDTO,
  ImPerson,
  ImPresence,
  ImReactionDTO,
  ImRailDTO,
  ImThreadPage,
} from '@/lib/messaging/types';
import { displayName, initialsOf } from '@/lib/tasks/queries';
import { listTenantMembersSynced } from '@/lib/tenant-members';

type MessageRow = typeof imMessages.$inferSelect;
type ChannelRow = typeof imChannels.$inferSelect;

/** Techo de respuestas de un hilo: más que esto no se lee, se resume. */
const REPLIES_LIMIT = 200;
const MENTIONS_LIMIT = 100;
const PINS_LIMIT = 50;

/** Texto de la lápida de un mensaje borrado. */
export const DELETED_BODY = 'Mensaje eliminado';

// ─── Personas ────────────────────────────────────────────────────────────────

/**
 * Miembros del tenant como `ImPerson`. Clerk es la fuente de verdad (igual que
 * en Tareas); si no se pasa el `clerkOrgId` se lee del tenant.
 *
 * Nunca lanza: sin personas el módulo se degrada a nombres vacíos, pero el
 * hilo se sigue viendo.
 */
export async function loadPeople(
  tenantId: string,
  clerkOrgId?: string | null,
): Promise<ImPerson[]> {
  try {
    let orgId = clerkOrgId ?? null;
    if (!orgId) {
      const [t] = await db
        .select({ orgId: tenants.clerkOrganizationId })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      orgId = t?.orgId ?? null;
    }
    if (!orgId) return [];

    const members = await listTenantMembersSynced(tenantId, orgId);
    return members.map((m) => {
      const name = displayName(m.firstName, m.lastName, m.email);
      return {
        userId: m.userId,
        clerkUserId: m.clerkUserId,
        email: m.email,
        name,
        initials: initialsOf(name),
        role: m.role,
      };
    });
  } catch (err) {
    console.warn('[messaging] loadPeople falló', {
      err: (err as Error).message,
    });
    return [];
  }
}

export function personMap(people: ImPerson[]): Map<string, ImPerson> {
  return new Map(people.map((p) => [p.userId, p]));
}

// ─── Serialización ───────────────────────────────────────────────────────────

/**
 * Fila de `im_messages` → DTO. Todo en ISO, nada de `Date` cruzando al cliente.
 *
 * Un mensaje borrado conserva la fila (trazabilidad clínica) pero sale vacío:
 * el cuerpo, los adjuntos y las acciones no viajan al navegador.
 */
export function toMessageDTO(
  row: MessageRow,
  opts?: {
    people?: Map<string, ImPerson>;
    reactions?: ImReactionDTO[];
    pinned?: boolean;
    saved?: boolean;
  },
): ImMessageDTO {
  const deleted = row.deletedAt != null;
  const person = row.senderUserId ? (opts?.people?.get(row.senderUserId) ?? null) : null;

  return {
    id: row.id,
    channelId: row.channelId,
    kind: row.kind,
    senderKind: row.senderKind,
    senderUserId: row.senderUserId ?? null,
    senderName: person?.name ?? (row.senderKind === 'USER' ? null : 'Cliniq'),
    senderInitials: person?.initials ?? (row.senderKind === 'USER' ? null : 'C'),
    body: deleted ? DELETED_BODY : row.body,
    parentId: row.parentId ?? null,
    replyCount: row.replyCount,
    contextType: row.contextType ?? null,
    contextId: row.contextId ?? null,
    contextPayload: deleted ? {} : (row.contextPayload ?? {}),
    attachments: deleted ? [] : (row.attachments ?? []),
    actions: deleted ? [] : (row.actions ?? []),
    eventKey: row.eventKey ?? null,
    mentions: row.mentions ?? [],
    mentionsEveryone: row.mentionsEveryone,
    reactions: deleted ? [] : (opts?.reactions ?? []),
    pinned: opts?.pinned ?? false,
    saved: opts?.saved ?? false,
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Reacciones agrupadas por emoji para un conjunto de mensajes. */
export async function loadReactionsFor(
  messageIds: string[],
): Promise<Map<string, ImReactionDTO[]>> {
  const out = new Map<string, ImReactionDTO[]>();
  if (messageIds.length === 0) return out;

  const rows = await db
    .select({
      messageId: imMessageReactions.messageId,
      emoji: imMessageReactions.emoji,
      userId: imMessageReactions.userId,
    })
    .from(imMessageReactions)
    .where(inArray(imMessageReactions.messageId, messageIds));

  for (const r of rows) {
    const list = out.get(r.messageId) ?? [];
    const hit = list.find((x) => x.emoji === r.emoji);
    if (hit) {
      hit.count += 1;
      hit.userIds.push(r.userId);
    } else {
      list.push({ emoji: r.emoji, count: 1, userIds: [r.userId] });
    }
    out.set(r.messageId, list);
  }
  return out;
}

// ─── Canales ─────────────────────────────────────────────────────────────────

/** En un DM el nombre del canal es la otra persona; en el resto, el suyo. */
function resolveChannelName(
  channel: Pick<ChannelRow, 'kind' | 'name' | 'contextLabel' | 'slug'>,
  counterpart: ImPerson | null,
  memberCount: number,
): string {
  if (channel.kind === 'DM') return counterpart?.name ?? 'Mensaje directo';
  if (channel.name) return channel.name;
  if (channel.contextLabel) return channel.contextLabel;
  if (channel.kind === 'GROUP') return `Grupo de ${memberCount}`;
  return channel.slug ?? 'Canal';
}

function toChannelDTO(args: {
  channel: ChannelRow;
  membership: typeof imChannelMembers.$inferSelect;
  memberIds: string[];
  viewerUserId: string;
  people: Map<string, ImPerson>;
  now: number;
}): ImChannelDTO {
  const { channel, membership, memberIds, viewerUserId, people, now } = args;
  const counterpartUserId =
    channel.kind === 'DM' ? (memberIds.find((id) => id !== viewerUserId) ?? null) : null;
  const counterpart = counterpartUserId ? (people.get(counterpartUserId) ?? null) : null;

  return {
    id: channel.id,
    kind: channel.kind,
    slug: channel.slug ?? null,
    name: resolveChannelName(channel, counterpart, memberIds.length),
    topic: channel.topic ?? null,
    icon: channel.icon ?? null,
    tone: isImTone(channel.tone) ? channel.tone : 'grape',
    isSystem: channel.isSystem,
    contextType: channel.contextType ?? null,
    contextId: channel.contextId ?? null,
    contextLabel: channel.contextLabel ?? null,
    lastMessageAt: channel.lastMessageAt ? channel.lastMessageAt.toISOString() : null,
    lastMessagePreview: channel.lastMessagePreview ?? null,
    messageCount: channel.messageCount,
    archived: channel.archivedAt != null,
    unreadCount: membership.unreadCount,
    mentionCount: membership.mentionCount,
    muted: membership.mutedUntil != null && membership.mutedUntil.getTime() > now,
    pinned: membership.pinned,
    memberRole: membership.role,
    memberIds,
    counterpartUserId,
  };
}

/** Ids de miembros activos, agrupados por canal. */
async function membersByChannel(
  tenantId: string,
  channelIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (channelIds.length === 0) return out;

  const rows = await db
    .select({
      channelId: imChannelMembers.channelId,
      userId: imChannelMembers.userId,
    })
    .from(imChannelMembers)
    .where(
      and(
        eq(imChannelMembers.tenantId, tenantId),
        inArray(imChannelMembers.channelId, channelIds),
        isNull(imChannelMembers.leftAt),
      ),
    );

  for (const r of rows) {
    const list = out.get(r.channelId) ?? [];
    list.push(r.userId);
    out.set(r.channelId, list);
  }
  return out;
}

/**
 * La query más caliente del módulo: hidrata el rail, el dock y los badges de
 * una sola vez. Tres consultas + Clerk + presencia, nada por canal.
 */
export async function loadRail(
  tenantId: string,
  userId: string,
  clerkOrgId: string,
): Promise<ImRailDTO> {
  const rows = await db
    .select({ channel: imChannels, membership: imChannelMembers })
    .from(imChannelMembers)
    .innerJoin(imChannels, eq(imChannels.id, imChannelMembers.channelId))
    .where(
      and(
        eq(imChannelMembers.tenantId, tenantId),
        eq(imChannelMembers.userId, userId),
        isNull(imChannelMembers.leftAt),
      ),
    )
    .orderBy(desc(imChannels.lastMessageAt), desc(imChannels.createdAt));

  const channelIds = rows.map((r) => r.channel.id);
  const [memberMap, people] = await Promise.all([
    membersByChannel(tenantId, channelIds),
    loadPeople(tenantId, clerkOrgId),
  ]);
  const byId = personMap(people);

  // Presencia: best-effort. Con Redis caído el rail se pinta igual, en gris.
  let presence: ImPresence[] = [];
  try {
    const { readPresence } = await import('@/lib/messaging/publisher');
    presence = await readPresence(
      tenantId,
      people.map((p) => p.userId),
    );
  } catch (err) {
    console.warn('[messaging] loadRail: presencia no disponible', {
      err: (err as Error).message,
    });
  }

  const now = Date.now();
  const channels = rows.map((r) =>
    toChannelDTO({
      channel: r.channel,
      membership: r.membership,
      memberIds: memberMap.get(r.channel.id) ?? [],
      viewerUserId: userId,
      people: byId,
      now,
    }),
  );

  // Fijados arriba; dentro de cada grupo, el que tuvo actividad más reciente.
  channels.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const at = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
    const bt = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
    if (at !== bt) return bt - at;
    return a.name.localeCompare(b.name, 'es');
  });

  let totalUnread = 0;
  let totalMentions = 0;
  for (const c of channels) {
    if (c.archived) continue;
    if (!c.muted) totalUnread += c.unreadCount;
    totalMentions += c.mentionCount;
  }

  return {
    channels,
    people,
    presence,
    totalUnread,
    totalMentions,
    me: byId.get(userId) ?? null,
  };
}

/** Un canal del que el usuario ya es miembro. `null` si no lo es. */
export async function loadChannel(
  tenantId: string,
  channelId: string,
  userId: string,
): Promise<ImChannelDTO | null> {
  const [row] = await db
    .select({ channel: imChannels, membership: imChannelMembers })
    .from(imChannelMembers)
    .innerJoin(imChannels, eq(imChannels.id, imChannelMembers.channelId))
    .where(
      and(
        eq(imChannelMembers.tenantId, tenantId),
        eq(imChannelMembers.channelId, channelId),
        eq(imChannelMembers.userId, userId),
        isNull(imChannelMembers.leftAt),
      ),
    )
    .limit(1);

  if (!row) return null;

  const [memberMap, people] = await Promise.all([
    membersByChannel(tenantId, [channelId]),
    loadPeople(tenantId),
  ]);

  return toChannelDTO({
    channel: row.channel,
    membership: row.membership,
    memberIds: memberMap.get(channelId) ?? [],
    viewerUserId: userId,
    people: personMap(people),
    now: Date.now(),
  });
}

// ─── Hilo ────────────────────────────────────────────────────────────────────

/**
 * Página de mensajes del canal con paginación **keyset** (`created_at < before`).
 * Nada de OFFSET: en un canal de 200 000 mensajes el offset se degrada a
 * seq-scan y el scroll infinito se cae solo.
 *
 * Se devuelve en orden cronológico ascendente, que es como lo pinta la UI.
 */
export async function loadThread(a: {
  tenantId: string;
  channelId: string;
  userId: string;
  before?: string | null;
  limit?: number;
}): Promise<ImThreadPage> {
  const limit = Math.min(Math.max(a.limit ?? THREAD_PAGE_SIZE, 1), 200);
  const before = a.before ? new Date(a.before) : null;
  const beforeValid = before && !Number.isNaN(before.getTime()) ? before : null;

  const rows = await db
    .select()
    .from(imMessages)
    .where(
      and(
        eq(imMessages.tenantId, a.tenantId),
        eq(imMessages.channelId, a.channelId),
        isNull(imMessages.parentId),
        ...(beforeValid ? [lt(imMessages.createdAt, beforeValid)] : []),
      ),
    )
    // +1 para saber si hay más sin pedir un count(*).
    .orderBy(desc(imMessages.createdAt), desc(imMessages.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const oldest = page[page.length - 1] ?? null;

  const messages = await hydrateMessages(a.tenantId, a.channelId, a.userId, page);
  // La consulta viene DESC (del final del canal hacia atrás); la UI lo quiere ASC.
  messages.reverse();

  return {
    messages,
    nextCursor: hasMore && oldest ? oldest.createdAt.toISOString() : null,
    hasMore,
  };
}

/** Reacciones + pins + guardados + nombres, en una tanda por página. */
async function hydrateMessages(
  tenantId: string,
  channelId: string | null,
  userId: string,
  rows: MessageRow[],
): Promise<ImMessageDTO[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [reactions, people, pinRows, savedRows] = await Promise.all([
    loadReactionsFor(ids),
    loadPeople(tenantId),
    db
      .select({ messageId: imPins.messageId })
      .from(imPins)
      .where(
        and(
          eq(imPins.tenantId, tenantId),
          inArray(imPins.messageId, ids),
          ...(channelId ? [eq(imPins.channelId, channelId)] : []),
        ),
      ),
    db
      .select({ messageId: imSavedMessages.messageId })
      .from(imSavedMessages)
      .where(and(eq(imSavedMessages.userId, userId), inArray(imSavedMessages.messageId, ids))),
  ]);

  const pinned = new Set(pinRows.map((p) => p.messageId));
  const saved = new Set(savedRows.map((s) => s.messageId));
  const byId = personMap(people);

  return rows.map((r) =>
    toMessageDTO(r, {
      people: byId,
      reactions: reactions.get(r.id) ?? [],
      pinned: pinned.has(r.id),
      saved: saved.has(r.id),
    }),
  );
}

/** Respuestas de un hilo, en orden cronológico. */
export async function loadReplies(a: {
  tenantId: string;
  parentId: string;
  userId: string;
}): Promise<ImMessageDTO[]> {
  const rows = await db
    .select()
    .from(imMessages)
    .where(and(eq(imMessages.tenantId, a.tenantId), eq(imMessages.parentId, a.parentId)))
    .orderBy(asc(imMessages.createdAt), asc(imMessages.id))
    .limit(REPLIES_LIMIT);

  return hydrateMessages(a.tenantId, null, a.userId, rows);
}

/** Un mensaje suelto (para el evento de realtime o el detalle de una mención). */
export async function loadMessage(
  tenantId: string,
  messageId: string,
  userId: string,
): Promise<ImMessageDTO | null> {
  const [row] = await db
    .select()
    .from(imMessages)
    .where(and(eq(imMessages.tenantId, tenantId), eq(imMessages.id, messageId)))
    .limit(1);

  if (!row) return null;
  const [dto] = await hydrateMessages(tenantId, row.channelId, userId, [row]);
  return dto ?? null;
}

/** Mensajes fijados del canal, del más reciente al más viejo. */
export async function loadPins(tenantId: string, channelId: string): Promise<ImMessageDTO[]> {
  const rows = await db
    .select({ message: imMessages })
    .from(imPins)
    .innerJoin(imMessages, eq(imMessages.id, imPins.messageId))
    .where(and(eq(imPins.tenantId, tenantId), eq(imPins.channelId, channelId)))
    .orderBy(desc(imPins.createdAt))
    .limit(PINS_LIMIT);

  const messages = rows.map((r) => r.message);
  if (messages.length === 0) return [];

  const [reactions, people] = await Promise.all([
    loadReactionsFor(messages.map((m) => m.id)),
    loadPeople(tenantId),
  ]);
  const byId = personMap(people);

  return messages.map((m) =>
    toMessageDTO(m, {
      people: byId,
      reactions: reactions.get(m.id) ?? [],
      pinned: true,
    }),
  );
}

// ─── Menciones y contadores ──────────────────────────────────────────────────

/** Bandeja "para mí". `onlyOpen` deja fuera las ya resueltas. */
export async function loadMentions(
  tenantId: string,
  userId: string,
  onlyOpen = false,
): Promise<ImMentionDTO[]> {
  const rows = await db
    .select({
      id: imMentions.id,
      messageId: imMentions.messageId,
      channelId: imMentions.channelId,
      readAt: imMentions.readAt,
      resolvedAt: imMentions.resolvedAt,
      createdAt: imMentions.createdAt,
      body: imMessages.body,
      deletedAt: imMessages.deletedAt,
      senderUserId: imMessages.senderUserId,
      senderKind: imMessages.senderKind,
      channel: imChannels,
    })
    .from(imMentions)
    .innerJoin(imMessages, eq(imMessages.id, imMentions.messageId))
    .innerJoin(imChannels, eq(imChannels.id, imMentions.channelId))
    .where(
      and(
        eq(imMentions.tenantId, tenantId),
        eq(imMentions.userId, userId),
        ...(onlyOpen ? [isNull(imMentions.resolvedAt)] : []),
      ),
    )
    .orderBy(desc(imMentions.createdAt))
    .limit(MENTIONS_LIMIT);

  if (rows.length === 0) return [];

  const dmChannelIds = rows.filter((r) => r.channel.kind === 'DM').map((r) => r.channelId);
  const [people, memberMap] = await Promise.all([
    loadPeople(tenantId),
    membersByChannel(tenantId, [...new Set(dmChannelIds)]),
  ]);
  const byId = personMap(people);

  return rows.map((r) => {
    const counterpartId = (memberMap.get(r.channelId) ?? []).find((id) => id !== userId) ?? null;
    const sender = r.senderUserId ? (byId.get(r.senderUserId) ?? null) : null;
    return {
      id: r.id,
      messageId: r.messageId,
      channelId: r.channelId,
      channelName: resolveChannelName(
        r.channel,
        counterpartId ? (byId.get(counterpartId) ?? null) : null,
        (memberMap.get(r.channelId) ?? []).length,
      ),
      body: r.deletedAt ? DELETED_BODY : r.body,
      senderName: sender?.name ?? (r.senderKind === 'USER' ? null : 'Cliniq'),
      readAt: r.readAt ? r.readAt.toISOString() : null,
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

/**
 * Totales del usuario para el badge del sidebar. Una fila, sin joins: es lo
 * único que puede correr en cada render del layout.
 */
export async function unreadSummary(
  tenantId: string,
  userId: string,
): Promise<{ totalUnread: number; totalMentions: number }> {
  const [row] = await db
    .select({
      totalUnread: sql<number>`coalesce(sum(${imChannelMembers.unreadCount}), 0)::int`,
      totalMentions: sql<number>`coalesce(sum(${imChannelMembers.mentionCount}), 0)::int`,
    })
    .from(imChannelMembers)
    .where(
      and(
        eq(imChannelMembers.tenantId, tenantId),
        eq(imChannelMembers.userId, userId),
        isNull(imChannelMembers.leftAt),
      ),
    );

  return {
    totalUnread: Number(row?.totalUnread ?? 0),
    totalMentions: Number(row?.totalMentions ?? 0),
  };
}

/** Clerk user id → `users.id` interno, que es lo que referencia todo el módulo. */
export async function internalUserIdFor(clerkUserId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);
  return row?.id ?? null;
}
