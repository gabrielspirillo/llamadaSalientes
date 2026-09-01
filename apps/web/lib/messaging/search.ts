import 'server-only';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { imChannelMembers, imChannels, imMessages } from '@/lib/db/schema';
import type { ImSearchHit } from '@/lib/messaging/types';
import { loadPeople, personMap } from '@/lib/messaging/queries';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/**
 * Búsqueda full-text sobre `im_messages`, en español (mismo idioma que la UI y
 * que el índice GIN `im_messages_fts_idx`).
 *
 * Acotada por diseño a los canales donde el usuario **es miembro**: un canal
 * privado no puede filtrarse por el buscador. El join con `im_channel_members`
 * es lo que garantiza el aislamiento, no un filtro posterior en memoria.
 */
export async function searchMessages(
  tenantId: string,
  userId: string,
  q: string,
  limit = DEFAULT_LIMIT,
): Promise<ImSearchHit[]> {
  const query = (q ?? '').trim().slice(0, 200);
  if (query.length < 2) return [];

  const take = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const tsquery = sql`plainto_tsquery('spanish', ${query})`;

  const rows = await db
    .select({
      messageId: imMessages.id,
      channelId: imMessages.channelId,
      senderUserId: imMessages.senderUserId,
      senderKind: imMessages.senderKind,
      createdAt: imMessages.createdAt,
      // Recorte con resaltado en markdown: el cuerpo ya se renderiza como
      // markdown acotado, así que `**` no introduce un formato nuevo.
      snippet: sql<string>`ts_headline('spanish', ${imMessages.body}, ${tsquery}, 'StartSel=**,StopSel=**,MaxWords=32,MinWords=12,ShortWord=2,HighlightAll=FALSE')`,
      channelKind: imChannels.kind,
      channelName: imChannels.name,
      channelSlug: imChannels.slug,
      channelLabel: imChannels.contextLabel,
    })
    .from(imMessages)
    .innerJoin(
      imChannelMembers,
      and(
        eq(imChannelMembers.channelId, imMessages.channelId),
        eq(imChannelMembers.userId, userId),
        isNull(imChannelMembers.leftAt),
      ),
    )
    .innerJoin(imChannels, eq(imChannels.id, imMessages.channelId))
    .where(
      and(
        eq(imMessages.tenantId, tenantId),
        isNull(imMessages.deletedAt),
        sql`to_tsvector('spanish', ${imMessages.body}) @@ ${tsquery}`,
      ),
    )
    .orderBy(desc(imMessages.createdAt))
    .limit(take);

  if (rows.length === 0) return [];

  // Los DM no tienen nombre propio: es la otra persona.
  const dmChannelIds = [
    ...new Set(rows.filter((r) => r.channelKind === 'DM').map((r) => r.channelId)),
  ];
  const [people, dmMembers] = await Promise.all([
    loadPeople(tenantId),
    dmChannelIds.length > 0
      ? db
          .select({
            channelId: imChannelMembers.channelId,
            userId: imChannelMembers.userId,
          })
          .from(imChannelMembers)
          .where(
            and(
              eq(imChannelMembers.tenantId, tenantId),
              inArray(imChannelMembers.channelId, dmChannelIds),
            ),
          )
      : Promise.resolve([] as Array<{ channelId: string; userId: string }>),
  ]);

  const byId = personMap(people);
  const counterpart = new Map<string, string>();
  for (const m of dmMembers) {
    if (m.userId !== userId) counterpart.set(m.channelId, m.userId);
  }

  return rows.map((r) => {
    const other = counterpart.get(r.channelId);
    const channelName =
      r.channelKind === 'DM'
        ? other
          ? (byId.get(other)?.name ?? 'Mensaje directo')
          : 'Mensaje directo'
        : (r.channelName ?? r.channelLabel ?? r.channelSlug ?? 'Canal');
    const sender = r.senderUserId ? (byId.get(r.senderUserId) ?? null) : null;

    return {
      messageId: r.messageId,
      channelId: r.channelId,
      channelName,
      senderName: sender?.name ?? (r.senderKind === 'USER' ? null : 'Cliniq'),
      snippet: (r.snippet ?? '').trim(),
      createdAt: r.createdAt.toISOString(),
    };
  });
}
