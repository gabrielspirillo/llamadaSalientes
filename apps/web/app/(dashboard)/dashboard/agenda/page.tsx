import { CalendarView } from '@/components/agenda/calendar-view';
import { PageHeader } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { getAgendaContext } from '@/lib/agenda/auth';
import {
  listAppointmentsInRange,
  listProfessionals,
  listTimeOffInRange,
  resolveTimezone,
} from '@/lib/agenda/queries';
import {
  computeDayWindow,
  toCalendarBlocks,
  toCalendarItems,
  weekDateKeys,
} from '@/lib/agenda/view';
import { db } from '@/lib/db/client';
import { professionalShifts, treatments } from '@/lib/db/schema';
import { localDateKey, zonedToUtc } from '@/lib/tasks/tz';
import { and, asc, eq } from 'drizzle-orm';
import { CalendarDays, Users } from 'lucide-react';
import Link from 'next/link';
import { AgendaNav } from './agenda-nav';

export const dynamic = 'force-dynamic';

/** Calendario de la clínica: un profesional o todos, por día o por semana. */
export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; prof?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAgendaContext();
  const timezone = await resolveTimezone(ctx.tenantId, null);

  const todayKey = localDateKey(new Date(), timezone);
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '')
    ? (params.date as string)
    : todayKey;
  const view = params.view === 'week' ? 'week' : 'day';

  const professionalRows = await listProfessionals(ctx.tenantId);

  // Un profesional restringido ve su agenda y sólo la suya: el selector ni
  // siquiera se dibuja, y el filtro no depende de lo que venga en la URL.
  const lockedToProfessional = ctx.scope === 'OWN' && Boolean(ctx.professional);
  const professionals = lockedToProfessional
    ? professionalRows.filter((p) => p.id === ctx.professional?.id)
    : professionalRows;

  const requestedProf = params.prof ?? (view === 'week' ? (professionals[0]?.id ?? 'all') : 'all');
  const selectedProfessionalId = lockedToProfessional
    ? (ctx.professional?.id ?? '')
    : professionals.some((p) => p.id === requestedProf)
      ? requestedProf
      : view === 'week'
        ? (professionals[0]?.id ?? '')
        : 'all';

  const dateKeys = view === 'week' ? weekDateKeys(dateKey) : [dateKey];
  const firstKey = dateKeys[0] ?? dateKey;
  const lastKey = dateKeys[dateKeys.length - 1] ?? dateKey;
  const [fy, fm, fd] = firstKey.split('-').map(Number);
  const [ly, lm, ld] = lastKey.split('-').map(Number);
  const from = zonedToUtc(fy ?? 2026, fm ?? 1, fd ?? 1, 0, 0, timezone);
  const to = new Date(
    zonedToUtc(ly ?? 2026, lm ?? 1, ld ?? 1, 0, 0, timezone).getTime() + 86_400_000,
  );

  const professionalIds = professionals.map((p) => p.id);
  const scopedIds =
    selectedProfessionalId === 'all' ? professionalIds : [selectedProfessionalId].filter(Boolean);

  const [appointments, blocks, catalog, shiftRows] = await Promise.all([
    scopedIds.length > 0
      ? listAppointmentsInRange(ctx.tenantId, {
          from,
          to,
          professionalIds: scopedIds,
          includeCancelled: true,
        })
      : Promise.resolve([]),
    scopedIds.length > 0
      ? listTimeOffInRange(ctx.tenantId, { from, to, professionalIds: scopedIds })
      : Promise.resolve([]),
    db
      .select({
        id: treatments.id,
        name: treatments.name,
        durationMinutes: treatments.durationMinutes,
      })
      .from(treatments)
      .where(and(eq(treatments.tenantId, ctx.tenantId), eq(treatments.active, true)))
      .orderBy(asc(treatments.name)),
    db
      .select({
        startMinute: professionalShifts.startMinute,
        endMinute: professionalShifts.endMinute,
      })
      .from(professionalShifts)
      .where(
        and(eq(professionalShifts.tenantId, ctx.tenantId), eq(professionalShifts.active, true)),
      ),
  ]);

  const items = toCalendarItems(
    appointments.map((a) => ({
      id: a.id,
      professionalId: a.professionalId,
      professionalName: a.professionalName,
      professionalColor: a.professionalColor,
      patientName: a.patientName,
      patientKey: a.patientKey,
      patientPhone: a.patientPhone,
      treatmentId: a.treatmentId,
      treatmentName: a.treatmentName,
      status: a.status,
      source: a.source,
      notes: a.notes,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
    })),
    dateKeys,
    timezone,
  );

  const calendarBlocks = toCalendarBlocks(
    blocks.map((b) => ({
      id: b.id,
      professionalId: b.professionalId,
      kind: b.kind,
      reason: b.reason,
      allDay: b.allDay,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
    })),
    dateKeys,
    timezone,
  );

  // La ventana la marcan el horario y las citas. Los bloqueos NO entran: un
  // "no vengo el jueves" ocupa el día entero y estiraría la rejilla a las 00:00,
  // dejando la franja útil fuera de la pantalla.
  const window = computeDayWindow(shiftRows, items);

  return (
    <>
      <PageHeader
        eyebrow="Agenda"
        icon={<CalendarDays className="h-5 w-5" />}
        title={lockedToProfessional ? 'Mi agenda' : 'Agenda'}
        description={
          lockedToProfessional
            ? 'Tus citas y tus pacientes.'
            : 'Calendario de todos los profesionales de la clínica.'
        }
        actions={
          ctx.canManageProfessionals ? (
            <Button asChild variant="secondary" size="sm">
              <Link href="/dashboard/agenda/profesionales">
                <Users className="h-4 w-4" /> Profesionales
              </Link>
            </Button>
          ) : undefined
        }
      />

      <AgendaNav active="calendario" ctx={{ canManageProfessionals: ctx.canManageProfessionals }} />

      <div className="mt-5">
        <CalendarView
          view={view}
          dateKey={dateKey}
          dateKeys={dateKeys}
          todayKey={todayKey}
          professionals={professionals.map((p) => ({
            id: p.id,
            fullName: p.fullName,
            color: p.color,
            agendaEnabled: p.agendaEnabled,
            specialty: p.specialty,
          }))}
          selectedProfessionalId={selectedProfessionalId}
          items={items}
          blocks={calendarBlocks}
          treatments={catalog}
          timezone={timezone}
          window={window}
          canWrite={ctx.canWriteAppointments}
          lockedToProfessional={lockedToProfessional}
        />
      </div>
    </>
  );
}
