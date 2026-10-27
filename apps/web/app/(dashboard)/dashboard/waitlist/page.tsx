import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import Link from 'next/link';

import { PageHeader } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardTopbar } from '@/components/ui/card';
import { Callout } from '@/components/ui/feedback';
import { type HistoryRow, HistoryTable } from '@/components/waitlist/HistoryTable';
import { type OfferRow, OffersTable } from '@/components/waitlist/OffersTable';
import { type QueueRow, QueueTable } from '@/components/waitlist/QueueTable';
import { WaitlistTabs } from '@/components/waitlist/Tabs';
import { db } from '@/lib/db/client';
import {
  agendaAppointments,
  appointmentsCache,
  cancelledSlots,
  clinicSettings,
  patientsCache,
  professionals,
  schedulingOffers,
  treatments,
  waitlistEntries,
  waitlistOffers,
} from '@/lib/db/schema';
import { resolveContactNames } from '@/lib/patients/registry';
import { getCurrentTenant } from '@/lib/tenant';
import { getOrCreateWaitlistSettings } from '@/lib/waitlist/settings';
import { ArrowUp, ListChecks, Settings2 } from 'lucide-react';
import { after } from 'next/server';

export const dynamic = 'force-dynamic';

function patientNameFrom(
  firstName: string | null,
  lastName: string | null,
  fallback?: string | null,
): string {
  const full = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  return fallback ?? 'Sin nombre';
}

export default async function WaitlistPage() {
  const { tenant } = await getCurrentTenant();
  // Upsert de conveniencia cuyo resultado la página no usa: bloqueaba el
  // render sin aportar nada. Mismo patrón que la auto-provisión de Tareas.
  after(() => {
    void getOrCreateWaitlistSettings(tenant.id).catch(() => undefined);
  });

  const [clinic] = await db
    .select({ timezone: clinicSettings.timezone })
    .from(clinicSettings)
    .where(eq(clinicSettings.tenantId, tenant.id))
    .limit(1);
  const tz = clinic?.timezone ?? 'Europe/Madrid';

  // Sin ningún tratamiento marcado, toda oferta se descarta en silencio
  // (`treatment_not_eligible`): se avisa aquí, que es donde se espera verla.
  const [eligible] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(treatments)
    .where(and(eq(treatments.tenantId, tenant.id), eq(treatments.waitlistEligible, true)));
  const noEligibleTreatments = (eligible?.n ?? 0) === 0;

  // Las tres consultas grandes de la página (cola, ofertas e histórico) son
  // independientes entre sí; encadenadas eran tres viajes en serie y esta es
  // la página más lenta de navegar del panel. Se lanzan juntas y cada bloque
  // se lanzan juntas.
  const [queueRowsRaw, offerRowsRaw, acceptedRowsRaw] = await Promise.all([
    db
      .select({
        id: waitlistEntries.id,
        ghlContactId: waitlistEntries.ghlContactId,
        treatmentId: waitlistEntries.treatmentId,
        originalStartTime: waitlistEntries.originalStartTime,
        createdAt: waitlistEntries.createdAt,
        status: waitlistEntries.status,
        source: waitlistEntries.source,
        notes: waitlistEntries.notes,
        preferredTimeWindowStart: waitlistEntries.preferredTimeWindowStart,
        preferredTimeWindowEnd: waitlistEntries.preferredTimeWindowEnd,
      })
      .from(waitlistEntries)
      .where(
        and(
          eq(waitlistEntries.tenantId, tenant.id),
          inArray(waitlistEntries.status, ['ACTIVE', 'PAUSED']),
        ),
      )
      .orderBy(desc(waitlistEntries.createdAt))
      .limit(500)
      .execute(),
    db
      .select({
        id: waitlistOffers.id,
        status: waitlistOffers.status,
        channel: waitlistOffers.channel,
        driverScope: waitlistOffers.driverScope,
        sentAt: waitlistOffers.sentAt,
        expiresAt: waitlistOffers.expiresAt,
        respondedAt: waitlistOffers.respondedAt,
        errorMessage: waitlistOffers.errorMessage,
        entryId: waitlistOffers.waitlistEntryId,
        cancelledSlotId: waitlistOffers.cancelledSlotId,
        slotStartTime: cancelledSlots.startTime,
        entryGhlContactId: waitlistEntries.ghlContactId,
        entryTreatmentId: waitlistEntries.treatmentId,
        entryOriginalStartTime: waitlistEntries.originalStartTime,
      })
      .from(waitlistOffers)
      .innerJoin(cancelledSlots, eq(cancelledSlots.id, waitlistOffers.cancelledSlotId))
      .innerJoin(waitlistEntries, eq(waitlistEntries.id, waitlistOffers.waitlistEntryId))
      .where(eq(waitlistOffers.tenantId, tenant.id))
      .orderBy(desc(waitlistOffers.createdAt))
      .limit(200)
      .execute(),
    db
      .select({
        offerId: waitlistOffers.id,
        acceptedAt: waitlistOffers.respondedAt,
        channel: waitlistOffers.channel,
        slotStartTime: cancelledSlots.startTime,
        entryGhlContactId: waitlistEntries.ghlContactId,
        entryTreatmentId: waitlistEntries.treatmentId,
        entryOriginalStartTime: waitlistEntries.originalStartTime,
        revenueCents: schedulingOffers.estimatedRevenueCents,
        currency: schedulingOffers.currency,
        source: schedulingOffers.source,
        newGhlAppointmentId: schedulingOffers.ghlAppointmentId,
      })
      .from(waitlistOffers)
      .innerJoin(cancelledSlots, eq(cancelledSlots.id, waitlistOffers.cancelledSlotId))
      .innerJoin(waitlistEntries, eq(waitlistEntries.id, waitlistOffers.waitlistEntryId))
      .leftJoin(
        schedulingOffers,
        and(
          eq(schedulingOffers.tenantId, waitlistOffers.tenantId),
          eq(schedulingOffers.cancelledSlotId, waitlistOffers.cancelledSlotId),
        ),
      )
      .where(and(eq(waitlistOffers.tenantId, tenant.id), eq(waitlistOffers.status, 'ACCEPTED')))
      .orderBy(desc(waitlistOffers.respondedAt))
      .limit(200)
      .execute(),
  ]);

  // ── Cola activa ──────────────────────────────────────────────────────────

  const treatmentIds = Array.from(
    new Set(queueRowsRaw.map((r) => r.treatmentId).filter((x): x is string => !!x)),
  );
  const contactIds = Array.from(new Set(queueRowsRaw.map((r) => r.ghlContactId)));

  const txMap = new Map<string, { name: string }>();
  if (treatmentIds.length > 0) {
    const txs = await db
      .select({ id: treatments.id, name: treatments.name })
      .from(treatments)
      .where(inArray(treatments.id, treatmentIds));
    for (const t of txs) txMap.set(t.id, { name: t.name });
  }

  const contactMap = new Map<
    string,
    { firstName: string | null; lastName: string | null; phone: string | null }
  >();
  // El nombre y el teléfono salen de donde estén: la réplica del CRM, la
  // libreta de la plataforma o el propio teléfono de la identidad de la agenda.
  if (contactIds.length > 0) {
    for (const [ref, info] of await resolveContactNames(tenant.id, contactIds)) {
      contactMap.set(ref, info);
    }
  }

  const queueRows: QueueRow[] = queueRowsRaw.map((r) => {
    const ct = contactMap.get(r.ghlContactId);
    return {
      id: r.id,
      patientName: patientNameFrom(ct?.firstName ?? null, ct?.lastName ?? null),
      contactPhone: ct?.phone ?? null,
      treatmentName: r.treatmentId ? (txMap.get(r.treatmentId)?.name ?? null) : null,
      originalStartTime: r.originalStartTime.toISOString(),
      createdAt: r.createdAt.toISOString(),
      status: r.status as QueueRow['status'],
      source: r.source as 'auto' | 'manual',
      notes: r.notes,
      preferredWindow: {
        start: r.preferredTimeWindowStart,
        end: r.preferredTimeWindowEnd,
      },
    };
  });

  // ── Ofertas en curso / recientes ────────────────────────────────────────

  // Cargar contactos + tratamientos de las ofertas que no estuvieran ya en queue.
  const offerContactIds = Array.from(new Set(offerRowsRaw.map((r) => r.entryGhlContactId)));
  const offerTreatmentIds = Array.from(
    new Set(offerRowsRaw.map((r) => r.entryTreatmentId).filter((x): x is string => !!x)),
  );
  const missingTxIds = offerTreatmentIds.filter((id) => !txMap.has(id));
  if (missingTxIds.length > 0) {
    const txs = await db
      .select({ id: treatments.id, name: treatments.name })
      .from(treatments)
      .where(inArray(treatments.id, missingTxIds));
    for (const t of txs) txMap.set(t.id, { name: t.name });
  }
  const missingContactIds = offerContactIds.filter((id) => !contactMap.has(id));
  if (missingContactIds.length > 0) {
    const pts = [...(await resolveContactNames(tenant.id, missingContactIds))].map(
      ([ghlContactId, info]) => ({ ghlContactId, ...info }),
    );
    for (const p of pts) {
      contactMap.set(p.ghlContactId, {
        firstName: p.firstName,
        lastName: p.lastName,
        phone: p.phone,
      });
    }
  }

  const offerRows: OfferRow[] = offerRowsRaw.map((r) => {
    const ct = contactMap.get(r.entryGhlContactId);
    return {
      id: r.id,
      patientName: patientNameFrom(ct?.firstName ?? null, ct?.lastName ?? null),
      contactPhone: ct?.phone ?? null,
      channel: r.channel as 'WHATSAPP' | 'VOICE',
      driverScope: r.driverScope,
      status: r.status as OfferRow['status'],
      sentAt: r.sentAt?.toISOString() ?? null,
      expiresAt: r.expiresAt.toISOString(),
      respondedAt: r.respondedAt?.toISOString() ?? null,
      oldAppointmentTime: r.entryOriginalStartTime.toISOString(),
      newSlotTime: r.slotStartTime.toISOString(),
      treatmentName: r.entryTreatmentId ? (txMap.get(r.entryTreatmentId)?.name ?? null) : null,
      errorMessage: r.errorMessage,
    };
  });

  const activeOffers = offerRows.filter((o) =>
    ['PENDING', 'SENT', 'EXPIRED', 'DECLINED'].includes(o.status),
  );

  // ── Histórico de aceptadas + totales de revenue ─────────────────────────

  const historyContactIds = Array.from(new Set(acceptedRowsRaw.map((r) => r.entryGhlContactId)));
  const histMissingContactIds = historyContactIds.filter((id) => !contactMap.has(id));
  if (histMissingContactIds.length > 0) {
    const pts = await db
      .select({
        ghlContactId: patientsCache.ghlContactId,
        firstName: patientsCache.firstName,
        lastName: patientsCache.lastName,
        phone: patientsCache.phone,
      })
      .from(patientsCache)
      .where(
        and(
          eq(patientsCache.tenantId, tenant.id),
          inArray(patientsCache.ghlContactId, histMissingContactIds),
        ),
      );
    for (const p of pts) {
      contactMap.set(p.ghlContactId, {
        firstName: p.firstName,
        lastName: p.lastName,
        phone: p.phone,
      });
    }
  }

  // Para la cita nueva concreta consultamos appointmentsCache cuando hay
  // newGhlAppointmentId — best-effort.
  const newApptIds = acceptedRowsRaw
    .map((r) => r.newGhlAppointmentId)
    .filter((id): id is string => !!id);
  const newApptMap = new Map<string, Date>();
  if (newApptIds.length > 0) {
    const rows = await db
      .select({
        ghlAppointmentId: appointmentsCache.ghlAppointmentId,
        startTime: appointmentsCache.startTime,
      })
      .from(appointmentsCache)
      .where(
        and(
          eq(appointmentsCache.tenantId, tenant.id),
          inArray(appointmentsCache.ghlAppointmentId, newApptIds),
        ),
      );
    for (const a of rows) {
      if (a.startTime) newApptMap.set(a.ghlAppointmentId, a.startTime);
    }
  }

  const historyRows: HistoryRow[] = acceptedRowsRaw.map((r) => {
    const ct = contactMap.get(r.entryGhlContactId);
    const newApptTime = r.newGhlAppointmentId
      ? (newApptMap.get(r.newGhlAppointmentId) ?? new Date(r.slotStartTime))
      : new Date(r.slotStartTime);
    return {
      id: r.offerId,
      patientName: patientNameFrom(ct?.firstName ?? null, ct?.lastName ?? null),
      oldAppointmentTime: r.entryOriginalStartTime.toISOString(),
      newAppointmentTime: newApptTime.toISOString(),
      treatmentName: r.entryTreatmentId ? (txMap.get(r.entryTreatmentId)?.name ?? null) : null,
      channel: r.channel as 'WHATSAPP' | 'VOICE',
      source: (r.source as HistoryRow['source']) ?? null,
      revenueCents: r.revenueCents ?? 0,
      currency: r.currency ?? 'EUR',
      acceptedAt: (r.acceptedAt ?? new Date()).toISOString(),
    };
  });

  const totals = {
    count: historyRows.length,
    revenueCents: historyRows.reduce((acc, r) => acc + r.revenueCents, 0),
    currency: historyRows[0]?.currency ?? 'EUR',
  };

  return (
    <>
      <PageHeader
        eyebrow="Recuperación de huecos"
        icon={<ListChecks className="h-5 w-5" />}
        title="Lista de espera"
        description="Pacientes con cita que quieren adelantarla. Cuando se libera un hueco, el sistema se lo ofrece al siguiente de la lista, por orden de llegada."
        actions={
          <Link href="/dashboard/waitlist/settings">
            <Button size="sm" variant="secondary">
              <Settings2 className="h-4 w-4" /> Configurar
            </Button>
          </Link>
        }
      />
      {noEligibleTreatments && (
        <Callout tone="warn" title="Ningún tratamiento admite lista de espera" className="mb-5">
          Mientras no marques al menos uno, los huecos liberados no se le ofrecen a nadie. Se marca
          en{' '}
          <Link href="/dashboard/waitlist/settings" className="font-semibold underline">
            Configurar
          </Link>
          .
        </Callout>
      )}

      <AdvanceRequests tenantId={tenant.id} tz={tz} />

      <WaitlistTabs
        queueCount={queueRows.length}
        offersCount={activeOffers.length}
        historyCount={historyRows.length}
        queue={<QueueTable rows={queueRows} tz={tz} />}
        offers={<OffersTable rows={offerRows} tz={tz} />}
        history={<HistoryTable rows={historyRows} tz={tz} totals={totals} />}
      />
    </>
  );
}

/**
 * Las citas marcadas en la agenda con ↑ (quiere adelantar), de la más próxima a
 * la más lejana, con el horario al que pueden venir. Es la "lista" que la
 * clínica llevaba con flechas en el papel: cuando se libera un hueco, aquí ve a
 * quién llamar. No envía nada sola.
 */
async function AdvanceRequests({ tenantId, tz }: { tenantId: string; tz: string }) {
  const rows = await db
    .select({
      id: agendaAppointments.id,
      startsAt: agendaAppointments.startsAt,
      patientKey: agendaAppointments.patientKey,
      patientName: agendaAppointments.patientName,
      patientPhone: agendaAppointments.patientPhone,
      note: agendaAppointments.advanceNote,
      professionalName: professionals.fullName,
      treatmentName: treatments.name,
    })
    .from(agendaAppointments)
    .innerJoin(professionals, eq(professionals.id, agendaAppointments.professionalId))
    .leftJoin(treatments, eq(treatments.id, agendaAppointments.treatmentId))
    .where(
      and(
        eq(agendaAppointments.tenantId, tenantId),
        eq(agendaAppointments.advancePreference, 'ACCEPTS'),
        gte(agendaAppointments.startsAt, new Date()),
        inArray(agendaAppointments.status, ['SCHEDULED', 'CONFIRMED']),
      ),
    )
    .orderBy(agendaAppointments.startsAt)
    .limit(100);

  const fmt = new Intl.DateTimeFormat('es-ES', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz });

  return (
    <Card className="mt-5">
      <CardTopbar
        icon={<ArrowUp className="h-4 w-4" />}
        title={`Quieren adelantar su cita (${rows.length})`}
      />
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-[13px] text-zinc-600">
            Nadie marcado. En la agenda, abre una cita y pulsa “Quiere adelantar”: aparecerá aquí
            con el horario al que puede venir.
          </p>
        ) : (
          <ul className="divide-y divide-(--color-border-subtle)">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-[13px]"
              >
                <span className="min-w-[180px] flex-1">
                  <Link
                    href={`/dashboard/agenda/pacientes/${encodeURIComponent(r.patientKey)}`}
                    className="font-bold text-zinc-900 hover:underline"
                  >
                    {r.patientName}
                  </Link>
                  <span className="block text-zinc-600">
                    Cita: {fmt.format(r.startsAt)} · {r.professionalName}
                    {r.treatmentName ? ` · ${r.treatmentName}` : ''}
                  </span>
                </span>
                <span className="min-w-[160px] text-zinc-700">
                  {r.note ? (
                    <>Puede: {r.note}</>
                  ) : (
                    <span className="text-zinc-500">Sin horario indicado</span>
                  )}
                </span>
                {r.patientPhone && (
                  <a
                    href={`tel:${r.patientPhone}`}
                    className="font-semibold text-brand-700 hover:underline"
                  >
                    {r.patientPhone}
                  </a>
                )}
                <Link
                  href={`/dashboard/agenda?date=${dayKey.format(r.startsAt)}`}
                  className="text-[12px] font-semibold text-zinc-600 hover:underline"
                >
                  Ver en la agenda
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// Mantengo sql en imports para uso futuro de helpers de agregación.
void sql;
void gte;
