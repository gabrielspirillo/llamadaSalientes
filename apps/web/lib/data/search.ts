import 'server-only';
import { db } from '@/lib/db/client';
import { calls, financeEntries, tenants, treatments } from '@/lib/db/schema';
import { listContacts } from '@/lib/ghl/contacts';
import { and, desc, eq, ilike, or } from 'drizzle-orm';

export type SearchHit =
  | { kind: 'call'; id: string; title: string; subtitle: string; href: string; when: Date | null }
  | { kind: 'treatment'; id: string; title: string; subtitle: string; href: string; when: null }
  | { kind: 'contact'; id: string; title: string; subtitle: string; href: string; when: null }
  | { kind: 'finance'; id: string; title: string; subtitle: string; href: string; when: null };

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
        ),
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
        or(ilike(treatments.name, like), ilike(treatments.description, like)),
      ),
    )
    .limit(5);

  // Movimientos del módulo Finanzas (concepto, proveedor, notas), sólo si la
  // clínica lo tiene contratado: un resultado que lleva a una página con
  // candado no es un resultado. Si la tabla no existe todavía, no rompe.
  const financeRows = await (async () => {
    try {
      const [t] = await db
        .select({ modules: tenants.enabledModules })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      if (!t?.modules?.finance) return [];
      return await db
        .select({
          id: financeEntries.id,
          kind: financeEntries.kind,
          concept: financeEntries.concept,
          counterparty: financeEntries.counterparty,
          amountCents: financeEntries.amountCents,
          occurredOn: financeEntries.occurredOn,
        })
        .from(financeEntries)
        .where(
          and(
            eq(financeEntries.tenantId, tenantId),
            or(
              ilike(financeEntries.concept, like),
              ilike(financeEntries.counterparty, like),
              ilike(financeEntries.notes, like),
            ),
          ),
        )
        .orderBy(desc(financeEntries.occurredOn))
        .limit(5);
    } catch {
      return [];
    }
  })();

  const hits: SearchHit[] = [];

  for (const f of financeRows) {
    const amount = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(
      f.amountCents / 100,
    );
    hits.push({
      kind: 'finance',
      id: f.id,
      title: f.concept,
      subtitle: `${f.kind === 'INCOME' ? 'Ingreso' : 'Gasto'} · ${amount} · ${f.occurredOn}${
        f.counterparty ? ` · ${f.counterparty}` : ''
      }`,
      href: `/dashboard/finanzas?tab=movimientos&period=last_12m&q=${encodeURIComponent(term)}`,
      when: null,
    });
  }

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

  // Contactos vivos de GHL (no en DB local — usan API externa).
  // Falla silenciosamente si GHL no está conectado.
  try {
    const { contacts } = await listContacts(tenantId, { query: term, limit: 5 });
    for (const c of contacts) {
      const name =
        [c.firstName, c.lastName].filter(Boolean).join(' ').trim() ||
        c.email ||
        c.phone ||
        'Sin nombre';
      hits.push({
        kind: 'contact',
        id: c.id,
        title: name,
        subtitle: [c.phone, c.email].filter(Boolean).join(' · ') || 'Contacto',
        href: `/dashboard/contacts?focus=${encodeURIComponent(c.id)}`,
        when: null,
      });
    }
  } catch (err) {
    console.error('[searchAll] GHL contacts fallo:', err);
  }

  return hits;
}
