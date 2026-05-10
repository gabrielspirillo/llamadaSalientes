import 'server-only';
import { db } from '@/lib/db/client';
import { calls, treatments } from '@/lib/db/schema';
import { and, desc, eq, ilike, or } from 'drizzle-orm';

export type SearchHit =
  | { kind: 'call'; id: string; title: string; subtitle: string; href: string; when: Date | null }
  | { kind: 'treatment'; id: string; title: string; subtitle: string; href: string; when: null };

/**
 * Búsqueda global: llamadas (por número, summary, intent) + tratamientos.
 */
export async function searchAll(tenantId: string, q: string, limit = 10): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const like = `%${term}%`;

  const callRows = await db
    .select({
      id: calls.id,
      retellCallId: calls.retellCallId,
      fromNumber: calls.fromNumber,
      toNumber: calls.toNumber,
      summary: calls.summary,
      intent: calls.intent,
      startedAt: calls.startedAt,
      customData: calls.customData,
    })
    .from(calls)
    .where(
      and(
        eq(calls.tenantId, tenantId),
        or(
          ilike(calls.fromNumber, like),
          ilike(calls.toNumber, like),
          ilike(calls.summary, like),
          ilike(calls.intent, like),
          ilike(calls.retellCallId, like),
        )!,
      ),
    )
    .orderBy(desc(calls.startedAt))
    .limit(limit);

  const treatmentRows = await db
    .select({ id: treatments.id, name: treatments.name, description: treatments.description })
    .from(treatments)
    .where(
      and(
        eq(treatments.tenantId, tenantId),
        or(ilike(treatments.name, like), ilike(treatments.description, like))!,
      ),
    )
    .limit(5);

  const hits: SearchHit[] = [];

  for (const c of callRows) {
    const cd = (c.customData ?? {}) as { patient_name?: string };
    const phone = c.fromNumber ?? c.toNumber ?? 'Sin número';
    hits.push({
      kind: 'call',
      id: c.id,
      title: cd.patient_name ?? phone,
      subtitle: c.summary ?? `Llamada · ${c.intent ?? 'sin clasificar'}`,
      href: `/dashboard/calls/${c.id}`,
      when: c.startedAt,
    });
  }

  for (const t of treatmentRows) {
    hits.push({
      kind: 'treatment',
      id: t.id,
      title: t.name,
      subtitle: t.description ?? 'Tratamiento',
      href: '/dashboard/treatments',
      when: null,
    });
  }

  return hits;
}
