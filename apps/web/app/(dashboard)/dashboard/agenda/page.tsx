import { CalendarView } from '@/components/agenda/calendar-view';
import { PageHeader } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { getAgendaContext } from '@/lib/agenda/auth';
import { paymentsForAppointments } from '@/lib/agenda/charges';
import { patientIdFromKey, phoneFromPatientKey } from '@/lib/agenda/patients';
import {
  countRedFlagsByPatientKey,
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
import { describeAge } from '@/lib/care-profile/policy';
import { getCareProfile } from '@/lib/care-profile/queries';
import {
  type FamilyPatient,
  appointmentTypeTag,
  familyTagFor,
  groupFamilies,
} from '@/lib/care-profile/siblings';
import { EMPTY_RED_FLAGS, type RedFlagCounts } from '@/lib/care-profile/signals';
import { db } from '@/lib/db/client';
import { professionalShifts, treatments } from '@/lib/db/schema';
import { getPatientPerson, listFamilyPatients } from '@/lib/patients/persons';
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
  searchParams: Promise<{ view?: string; date?: string; prof?: string; paciente?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAgendaContext();

  // Las tres sólo dependen del tenant, que `getAgendaContext` ya resolvió:
  // encadenadas eran tres round-trips en serie antes de empezar a mirar el
  // calendario, en la pantalla más visitada del módulo.
  //
  // `careProfile` decide si esta clínica lleva a sus pacientes como personas
  // (con edad y ficha propia). Sin perfil, nada de eso se carga después.
  const [timezone, professionalRows, careProfile] = await Promise.all([
    resolveTimezone(ctx.tenantId, null),
    listProfessionals(ctx.tenantId),
    getCareProfile(ctx.tenantId),
  ]);

  const todayKey = localDateKey(new Date(), timezone);
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '')
    ? (params.date as string)
    : todayKey;
  const view = params.view === 'week' ? 'week' : 'day';

  // "Agendar" desde la ficha: la clave del paciente viene en la URL y el alta
  // se abre ya rellena. Una clave que no resuelve a nadie no abre nada.
  const requestedPatientKey = params.paciente?.trim() ?? '';
  let newAppointmentFor: {
    patientId: string | null;
    patientName: string;
    patientPhone: string | null;
  } | null = null;
  if (requestedPatientKey) {
    const personId = patientIdFromKey(requestedPatientKey);
    const person = personId ? await getPatientPerson(ctx.tenantId, personId) : null;
    if (person) {
      newAppointmentFor = {
        patientId: person.id,
        patientName: person.fullName,
        patientPhone: person.contactPhone,
      };
    } else {
      const phone = phoneFromPatientKey(requestedPatientKey);
      if (phone) newAppointmentFor = { patientId: null, patientName: '', patientPhone: phone };
    }
  }

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
          // Una cancelada deja el hueco libre a la vista; sigue en la ficha,
          // en Actividad y contando para las banderas rojas. No se borra.
          includeCancelled: false,
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

  // Lo que depende de las citas del rango, en una sola tanda:
  // - banderas rojas, contando TODAS las citas del paciente (no sólo las del rango);
  // - el cobro de cada cita (el chip pinta datáfono o euro);
  // - los pacientes de la clínica para saber quién es hermano o gemelo.
  const [redFlagsByKey, paymentsById, familyPatients] = await Promise.all([
    careProfile
      ? countRedFlagsByPatientKey(
          ctx.tenantId,
          appointments.map((a) => a.patientKey),
        ).catch(() => new Map<string, RedFlagCounts>())
      : Promise.resolve(new Map<string, RedFlagCounts>()),
    paymentsForAppointments(
      ctx.tenantId,
      appointments.map((a) => a.id),
    ).catch(() => new Map()),
    careProfile && appointments.some((a) => a.patientId)
      ? listFamilyPatients(ctx.tenantId, timezone).catch(() => [])
      : Promise.resolve([]),
  ]);

  // Hermanos (H) y gemelos/mellizos (G/M), sobre los días que se ven.
  const families = groupFamilies(familyPatients);
  const familyById = new Map(familyPatients.map((p) => [p.id, p]));
  const familyTagOf = (patientId: string | null, startsAt: Date) => {
    const me = patientId ? familyById.get(patientId) : undefined;
    if (!me) return null;
    const siblings = (families.get(me.id) ?? [])
      .map((id) => familyById.get(id))
      .filter((x): x is FamilyPatient => Boolean(x));
    return familyTagFor(me, localDateKey(startsAt, timezone), siblings);
  };

  const items = toCalendarItems(
    appointments.map((a) => ({
      id: a.id,
      professionalId: a.professionalId,
      professionalName: a.professionalName,
      professionalColor: a.professionalColor,
      patientName: a.patientName,
      patientKey: a.patientKey,
      patientPhone: a.patientPhone,
      // La edad con número sólo existe si el paciente tiene fecha de nacimiento;
      // la etiqueta de primera visita, sólo en las clínicas con perfil.
      patientAge: a.patientBirthDate ? describeAge(a.patientBirthDate, todayKey) : null,
      ...(() => {
        const tag = careProfile
          ? appointmentTypeTag({
              isFirstVisit: a.isFirstVisit,
              treatmentName: a.treatmentName,
              familyTag: familyTagOf(a.patientId, a.startsAt),
            })
          : { firstVisit: false, familyTag: null };
        return { ...tag, badge: tag.firstVisit ? '1ª visita' : null };
      })(),
      payment: paymentsById.get(a.id) ?? null,
      treatmentPriceCents: a.treatmentPriceCents,
      advancePreference: a.advancePreference ?? null,
      advanceNote: a.advanceNote ?? null,
      signals: careProfile
        ? {
            redFlags: {
              ...(redFlagsByKey.get(a.patientKey) ?? EMPTY_RED_FLAGS),
              prior: a.patientPriorRedFlags,
            },
            hesitant: a.patientHesitant,
            hesitantNote: a.patientHesitantNote,
          }
        : null,
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
          // Con perfil, el alta de cita busca pacientes en el servidor
          // (`/api/agenda/patients`) en vez de recibir la lista entera.
          patientSearch={Boolean(careProfile) && ctx.canWriteAppointments}
          timezone={timezone}
          window={window}
          canWrite={ctx.canWriteAppointments}
          lockedToProfessional={lockedToProfessional}
          newAppointmentFor={newAppointmentFor}
          visibleStatuses={careProfile?.bookingPolicy.visibleStatuses ?? null}
          showFamilyTags={Boolean(careProfile)}
        />
      </div>
    </>
  );
}
