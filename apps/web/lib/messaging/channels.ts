import 'server-only';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { imChannelMembers, imChannels, tenantMemberships } from '@/lib/db/schema';
import {
  SEED_CHANNELS,
  type ImChannelKind,
  type ImContextType,
  type ImTone,
} from '@/lib/messaging/constants';
import type { ImRealtimeEvent } from '@/lib/messaging/events';

/**
 * Silenciar un canal no tiene fecha de fin en la UI: es un interruptor. Se
 * guarda como una fecha muy lejana para no agregar otra columna booleana.
 */
const MUTE_FOREVER = new Date('2999-12-31T00:00:00.000Z');

/** Publicación best-effort: Redis caído nunca rompe una escritura. */
async function publish(tenantId: string, channelId: string, event: ImRealtimeEvent): Promise<void> {
  try {
    const { publishToChannelMembers } = await import('@/lib/messaging/publisher');
    await publishToChannelMembers(tenantId, channelId, event);
  } catch (err) {
    console.warn('[messaging] publish de canal falló', {
      channelId,
      kind: event.kind,
      err: (err as Error).message,
    });
  }
}

/** Ids internos de todos los miembros del tenant (tabla local, sin Clerk). */
async function allTenantUserIds(tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: tenantMemberships.userId })
    .from(tenantMemberships)
    .where(eq(tenantMemberships.tenantId, tenantId));
  return rows.map((r) => r.userId);
}

/**
 * Alta de membresías. Idempotente: reactiva a quien se había ido en vez de
 * duplicar la fila (la PK es (channel_id, user_id)).
 */
async function upsertMembers(
  tenantId: string,
  channelId: string,
  userIds: string[],
  role: 'OWNER' | 'MEMBER' = 'MEMBER',
): Promise<void> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return;

  await db
    .insert(imChannelMembers)
    .values(unique.map((userId) => ({ channelId, userId, tenantId, role })))
    .onConflictDoUpdate({
      target: [imChannelMembers.channelId, imChannelMembers.userId],
      set: { leftAt: null },
    });
}

/** Busca un canal del tenant por su clave de deduplicación. */
async function findByDedupeKey(tenantId: string, dedupeKey: string): Promise<string | null> {
  const [row] = await db
    .select({ id: imChannels.id })
    .from(imChannels)
    .where(and(eq(imChannels.tenantId, tenantId), eq(imChannels.dedupeKey, dedupeKey)))
    .limit(1);
  return row?.id ?? null;
}

// ─── Alta ────────────────────────────────────────────────────────────────────

export async function createChannel(a: {
  tenantId: string;
  kind: ImChannelKind;
  name?: string | null;
  slug?: string | null;
  topic?: string | null;
  icon?: string | null;
  tone?: ImTone;
  createdByUserId: string;
  memberUserIds: string[];
}): Promise<{ id: string }> {
  const slug = a.slug ? a.slug.trim().toLowerCase() : null;

  const [row] = await db
    .insert(imChannels)
    .values({
      tenantId: a.tenantId,
      kind: a.kind,
      slug,
      name: a.name?.trim() || null,
      topic: a.topic?.trim() || null,
      icon: a.icon ?? null,
      tone: a.tone ?? 'grape',
      dedupeKey: slug ? `slug:${slug}` : null,
      createdByUserId: a.createdByUserId,
    })
    .onConflictDoNothing()
    .returning({ id: imChannels.id });

  // Slug repetido: el canal ya existe, sumamos a quien pidió crearlo.
  if (!row) {
    const existing = slug ? await findByDedupeKey(a.tenantId, `slug:${slug}`) : null;
    if (!existing) throw new Error('No se pudo crear el canal');
    await upsertMembers(a.tenantId, existing, [a.createdByUserId, ...a.memberUserIds]);
    return { id: existing };
  }

  await upsertMembers(a.tenantId, row.id, [a.createdByUserId], 'OWNER');
  await upsertMembers(
    a.tenantId,
    row.id,
    a.memberUserIds.filter((id) => id !== a.createdByUserId),
  );

  return { id: row.id };
}

/**
 * DM 1 a 1. La clave se arma con los ids **ordenados** para que sea simétrica:
 * abrir el chat desde cualquiera de los dos lados cae en el mismo canal.
 */
export async function ensureDmChannel(a: {
  tenantId: string;
  userIdA: string;
  userIdB: string;
}): Promise<{ id: string }> {
  const sorted = [a.userIdA, a.userIdB].sort();
  const lo = sorted[0] ?? a.userIdA;
  const hi = sorted[1] ?? a.userIdB;
  const dedupeKey = `dm:${lo}:${hi}`;

  const [row] = await db
    .insert(imChannels)
    .values({ tenantId: a.tenantId, kind: 'DM', tone: 'sky', dedupeKey })
    .onConflictDoNothing()
    .returning({ id: imChannels.id });

  const id = row?.id ?? (await findByDedupeKey(a.tenantId, dedupeKey));
  if (!id) throw new Error('No se pudo crear el mensaje directo');

  await upsertMembers(a.tenantId, id, [lo, hi], 'OWNER');
  return { id };
}

/**
 * Hilo anclado a una entidad del producto (paciente, llamada, tarea…).
 * Un solo canal por entidad, garantizado por el índice único parcial.
 */
export async function ensureContextChannel(a: {
  tenantId: string;
  contextType: ImContextType;
  contextId: string;
  label: string;
  createdByUserId?: string | null;
  memberUserIds?: string[];
}): Promise<{ id: string }> {
  const dedupeKey = `${a.contextType.toLowerCase()}:${a.contextId}`;

  const [row] = await db
    .insert(imChannels)
    .values({
      tenantId: a.tenantId,
      kind: 'CONTEXT',
      name: a.label.slice(0, 200),
      tone: 'blossom',
      contextType: a.contextType,
      contextId: a.contextId,
      contextLabel: a.label.slice(0, 200),
      dedupeKey,
      createdByUserId: a.createdByUserId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: imChannels.id });

  const id = row?.id ?? (await findByDedupeKey(a.tenantId, dedupeKey));
  if (!id) throw new Error('No se pudo crear el hilo de contexto');

  const members = a.memberUserIds?.length
    ? a.memberUserIds
    : a.createdByUserId
      ? [a.createdByUserId]
      : await allTenantUserIds(a.tenantId);
  await upsertMembers(a.tenantId, id, members);

  return { id };
}

/**
 * Canal de sistema por slug. Si falta, lo crea desde `SEED_CHANNELS` y suma a
 * TODO el tenant: es lo que hace que el bot pueda publicar en 'urgencias' sin
 * que nadie haya entrado nunca al módulo.
 */
export async function ensureSlugChannel(a: {
  tenantId: string;
  slug: string;
}): Promise<{
  id: string;
}> {
  const slug = a.slug.trim().toLowerCase();
  const dedupeKey = `slug:${slug}`;
  const seed = SEED_CHANNELS.find((c) => c.slug === slug);

  const [row] = await db
    .insert(imChannels)
    .values({
      tenantId: a.tenantId,
      kind: 'PUBLIC',
      slug,
      name: seed?.name ?? slug.charAt(0).toUpperCase() + slug.slice(1),
      topic: seed?.topic ?? null,
      icon: seed?.icon ?? 'Hash',
      tone: seed?.tone ?? 'grape',
      isSystem: Boolean(seed),
      dedupeKey,
    })
    .onConflictDoNothing()
    .returning({ id: imChannels.id });

  const id = row?.id ?? (await findByDedupeKey(a.tenantId, dedupeKey));
  if (!id) throw new Error(`No se pudo crear el canal ${slug}`);

  await upsertMembers(a.tenantId, id, await allTenantUserIds(a.tenantId));
  return { id };
}

// ─── Membresías y preferencias ───────────────────────────────────────────────

export async function addMembers(a: {
  tenantId: string;
  channelId: string;
  userIds: string[];
}): Promise<void> {
  const unique = [...new Set(a.userIds.filter(Boolean))];
  if (unique.length === 0) return;

  await upsertMembers(a.tenantId, a.channelId, unique);
  for (const userId of unique) {
    await publish(a.tenantId, a.channelId, {
      kind: 'channel.member_joined',
      channelId: a.channelId,
      userId,
    });
  }
}

/** Salida blanda: `left_at`. La membresía queda como registro de que estuvo. */
export async function removeMember(a: {
  tenantId: string;
  channelId: string;
  userId: string;
}): Promise<void> {
  await db
    .update(imChannelMembers)
    .set({ leftAt: sql`now()`, unreadCount: 0, mentionCount: 0 })
    .where(
      and(
        eq(imChannelMembers.tenantId, a.tenantId),
        eq(imChannelMembers.channelId, a.channelId),
        eq(imChannelMembers.userId, a.userId),
      ),
    );

  await publish(a.tenantId, a.channelId, {
    kind: 'channel.member_left',
    channelId: a.channelId,
    userId: a.userId,
  });
}

export async function updateChannel(a: {
  tenantId: string;
  channelId: string;
  patch: {
    name?: string | null;
    topic?: string | null;
    icon?: string | null;
    tone?: ImTone;
    archived?: boolean;
  };
}): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (a.patch.name !== undefined) set.name = a.patch.name?.trim() || null;
  if (a.patch.topic !== undefined) set.topic = a.patch.topic?.trim() || null;
  if (a.patch.icon !== undefined) set.icon = a.patch.icon ?? null;
  if (a.patch.tone !== undefined) set.tone = a.patch.tone;
  if (a.patch.archived !== undefined) set.archivedAt = a.patch.archived ? new Date() : null;

  await db
    .update(imChannels)
    .set(set)
    .where(and(eq(imChannels.tenantId, a.tenantId), eq(imChannels.id, a.channelId)));

  await publish(a.tenantId, a.channelId, {
    kind: 'channel.updated',
    channelId: a.channelId,
  });
}

/** Silenciar y fijar son preferencias **del usuario**, no del canal. */
export async function setMemberPrefs(a: {
  tenantId: string;
  channelId: string;
  userId: string;
  muted?: boolean;
  pinned?: boolean;
}): Promise<void> {
  const set: Record<string, unknown> = {};
  if (a.muted !== undefined) set.mutedUntil = a.muted ? MUTE_FOREVER : null;
  if (a.pinned !== undefined) set.pinned = a.pinned;
  if (Object.keys(set).length === 0) return;

  await db
    .update(imChannelMembers)
    .set(set)
    .where(
      and(
        eq(imChannelMembers.tenantId, a.tenantId),
        eq(imChannelMembers.channelId, a.channelId),
        eq(imChannelMembers.userId, a.userId),
      ),
    );
}

/** Miembros activos del canal. Lo usa el fan-out de `sendMessage`. */
export async function activeMemberIds(tenantId: string, channelId: string): Promise<string[]> {
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

/** Filtra ids que no pertenezcan al tenant. Nunca confiar en el cliente. */
export async function filterTenantUserIds(tenantId: string, userIds: string[]): Promise<string[]> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return [];

  const rows = await db
    .select({ userId: tenantMemberships.userId })
    .from(tenantMemberships)
    .where(
      and(eq(tenantMemberships.tenantId, tenantId), inArray(tenantMemberships.userId, unique)),
    );
  return rows.map((r) => r.userId);
}
