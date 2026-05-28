import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import Link from 'next/link';

import { PageHeader } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { HistoryTable, type HistoryRow } from '@/components/waitlist/HistoryTable';
import { OffersTable, type OfferRow } from '@/components/waitlist/OffersTable';
import { QueueTable, type QueueRow } from '@/components/waitlist/QueueTable';
import { WaitlistTabs } from '@/components/waitlist/Tabs';
import { db } from '@/lib/db/client';
import {
  appointmentsCache,
  cancelledSlots,
  clinicSettings,
  patientsCache,
  schedulingOffers,
  treatments,
  waitlistEntries,
  waitlistOffers,
} from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';
import { getOrCreateWaitlistSettings } from '@/lib/waitlist/settings';
import { Settings2 } from 'lucide-react';

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
  await getOrCreateWaitlistSettings(tenant.id);

  const [clinic] = await db
    .select({ timezone: clinicSettings.timezone })
    .from(clinicSettings)
    .where(eq(clinicSettings.tenantId, tenant.id))
    .limit(1);
  const tz = clinic?.timezone ?? 'Europe/Madrid';

  // ── Cola activa ──────────────────────────────────────────────────────────
  const queueRowsRaw = await db
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
    .limit(500);

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
  if (contactIds.length > 0) {
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
          inArray(patientsCache.ghlContactId, contactIds),
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

  const queueRows: QueueRow[] = queueRowsRaw.map((r) => {
    const ct = contactMap.get(r.ghlContactId);
    return {
      id: r.id,
      patientName: patientNameFrom(ct?.firstName ?? null, ct?.lastName ?? null),
      contactPhone: ct?.phone ?? null,
      treatmentName: r.treatmentId ? txMap.get(r.treatmentId)?.name ?? null : null,
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
  const offerRowsRaw = await db
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
    .limit(200);

  // Cargar contactos + tratamientos de las ofertas que no estuvieran ya en queue.
  const offerContactIds = Array.from(
    new Set(offerRowsRaw.map((r) => r.entryGhlContactId)),
  );
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
          inArray(patientsCache.ghlContactId, missingContactIds),
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
      treatmentName: r.entryTreatmentId ? txMap.get(r.entryTreatmentId)?.name ?? null : null,
      errorMessage: r.errorMessage,
    };
  });

  const activeOffers = offerRows.filter((o) =>
    ['PENDING', 'SENT', 'EXPIRED', 'DECLINED'].includes(o.status),
  );

  // ── Histórico de aceptadas + totales de revenue ─────────────────────────
  const acceptedRowsRaw = await db
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
    .limit(200);

  const historyContactIds = Array.from(
    new Set(acceptedRowsRaw.map((r) => r.entryGhlContactId)),
  );
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
      ? newApptMap.get(r.newGhlAppointmentId) ?? new Date(r.slotStartTime)
      : new Date(r.slotStartTime);
    return {
      id: r.offerId,
      patientName: patientNameFrom(ct?.firstName ?? null, ct?.lastName ?? null),
      oldAppointmentTime: r.entryOriginalStartTime.toISOString(),
      newAppointmentTime: newApptTime.toISOString(),
      treatmentName: r.entryTreatmentId ? txMap.get(r.entryTreatmentId)?.name ?? null : null,
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
        title="Waitlist"
        description="Cola FIFO de pacientes con cita futura. Cuando un slot se libera, el sistema oferta el hueco al siguiente en cola."
        actions={
          <Link href="/dashboard/waitlist/settings">
            <Button size="sm" variant="secondary">
              <Settings2 className="h-4 w-4" /> Configurar
            </Button>
          </Link>
        }
      />

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

// Mantengo sql en imports para uso futuro de helpers de agregación.
void sql;
void gte;
