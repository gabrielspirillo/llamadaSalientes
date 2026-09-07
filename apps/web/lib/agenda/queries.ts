import 'server-only';
import { and, asc, desc, eq, gte, inArray, lt, lte, ne, or, sql } from 'drizzle-orm';

import { type SlotOptions, computeRangeSlots } from '@/lib/agenda/availability';
import { BUSY_STATUSES, type ShiftRule, type SlotCandidate } from '@/lib/agenda/shared';
import { db } from '@/lib/db/client';
import {
  agendaAppointments,
  clinicSettings,
  clinicalNotes,
  professionalShifts,
  professionalTimeOff,
  professionalTreatments,
  professionals,
  treatments,
  users,
} from '@/lib/db/schema';
import { addDaysToKey, localDateKey } from '@/lib/tasks/tz';

export type ProfessionalRow = typeof professionals.$inferSelect;
export type AppointmentRow = typeof agendaAppointments.$inferSelect;
export type ClinicalNoteRow = typeof clinicalNotes.$inferSelect;
export type ShiftRow = typeof professionalShifts.$inferSelect;
export type TimeOffRow = typeof professionalTimeOff.$inferSelect;

/**
 * Timezone de la clínica.
 *
 * Se lee aquí y no se reutiliza la de `lib/tasks/materialize`: aquella arrastra
 * el módulo de Tareas entero —y con él BullMQ y la mensajería— hasta el
 * calendario y hasta los agentes, que no necesitan nada de eso.
 */
export async function getClinicTimezone(tenantId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: clinicSettings.timezone })
    .from(clinicSettings)
    .where(eq(clinicSettings.tenantId, tenantId))
    .limit(1);
  return row?.timezone || 'Europe/Madrid';
}

/** Timezone efectiva: la del profesional si tiene una propia, si no la de la clínica. */
export async function resolveTimezone(
  tenantId: string,
  professional?: { timezone: string | null } | null,
): Promise<string> {
  if (professional?.timezone) return professional.timezone;
  return getClinicTimezone(tenantId);
}

// ─── Profesionales ───────────────────────────────────────────────────────────

export interface ProfessionalSummary extends ProfessionalRow {
  treatmentCount: number;
  shiftCount: number;
  /** Email del usuario de la plataforma vinculado, si lo hay. */
  linkedUserEmail: string | null;
  upcomingAppointments: number;
}

export async function listProfessionals(
  tenantId: string,
  opts: { includeInactive?: boolean; onlyId?: string } = {},
): Promise<ProfessionalSummary[]> {
  const where = [eq(professionals.tenantId, tenantId)];
  if (!opts.includeInactive) where.push(eq(professionals.active, true));
  if (opts.onlyId) where.push(eq(professionals.id, opts.onlyId));

  const rows = await db
    .select({
      professional: professionals,
      linkedUserEmail: users.email,
    })
    .from(professionals)
    .leftJoin(users, eq(users.id, professionals.userId))
    .where(and(...where))
    .orderBy(desc(professionals.agendaEnabled), asc(professionals.fullName));

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.professional.id);

  // Tres agregados en tres queries, no una por fila: la lista de profesionales
  // se dibuja en cada navegación a /dashboard/agenda.
  const [treatmentCounts, shiftCounts, upcoming] = await Promise.all([
    db
      .select({ professionalId: professionalTreatments.professionalId, n: sql<number>`count(*)` })
      .from(professionalTreatments)
      .where(
        and(
          eq(professionalTreatments.tenantId, tenantId),
          inArray(professionalTreatments.professionalId, ids),
        ),
      )
      .groupBy(professionalTreatments.professionalId),
    db
      .select({ professionalId: professionalShifts.professionalId, n: sql<number>`count(*)` })
      .from(professionalShifts)
      .where(
        and(
          eq(professionalShifts.tenantId, tenantId),
          eq(professionalShifts.active, true),
          inArray(professionalShifts.professionalId, ids),
        ),
      )
      .groupBy(professionalShifts.professionalId),
    db
      .select({ professionalId: agendaAppointments.professionalId, n: sql<number>`count(*)` })
      .from(agendaAppointments)
      .where(
        and(
          eq(agendaAppointments.tenantId, tenantId),
          inArray(agendaAppointments.professionalId, ids),
          gte(agendaAppointments.startsAt, new Date()),
          inArray(agendaAppointments.status, BUSY_STATUSES),
        ),
      )
      .groupBy(agendaAppointments.professionalId),
  ]);

  const byId = <T extends { professionalId: string; n: number }>(list: T[]) =>
    new Map(list.map((x) => [x.professionalId, Number(x.n)]));
  const tMap = byId(treatmentCounts);
  const sMap = byId(shiftCounts);
  const aMap = byId(upcoming);

  return rows.map((r) => ({
    ...r.professional,
    linkedUserEmail: r.linkedUserEmail ?? null,
    treatmentCount: tMap.get(r.professional.id) ?? 0,
    shiftCount: sMap.get(r.professional.id) ?? 0,
    upcomingAppointments: aMap.get(r.professional.id) ?? 0,
  }));
}

export async function getProfessional(
  tenantId: string,
  professionalId: string,
): Promise<ProfessionalRow | null> {
  const rows = await db
    .select()
    .from(professionals)
    .where(and(eq(professionals.tenantId, tenantId), eq(professionals.id, professionalId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface ProfessionalDetail {
  professional: ProfessionalRow;
  linkedUserEmail: string | null;
  shifts: ShiftRow[];
  timeOff: TimeOffRow[];
  treatments: {
    treatmentId: string;
    name: string;
    durationMinutes: number;
    durationOverrideMinutes: number | null;
    active: boolean | null;
  }[];
  /** Catálogo completo del tenant, para el selector de tratamientos. */
  catalog: { id: string; name: string; durationMinutes: number; active: boolean | null }[];
}

export async function getProfessionalDetail(
  tenantId: string,
  professionalId: string,
): Promise<ProfessionalDetail | null> {
  const [row] = await db
    .select({ professional: professionals, linkedUserEmail: users.email })
    .from(professionals)
    .leftJoin(users, eq(users.id, professionals.userId))
    .where(and(eq(professionals.tenantId, tenantId), eq(professionals.id, professionalId)))
    .limit(1);
  if (!row) return null;

  const [shifts, timeOff, assigned, catalog] = await Promise.all([
    db
      .select()
      .from(professionalShifts)
      .where(
        and(
          eq(professionalShifts.tenantId, tenantId),
          eq(professionalShifts.professionalId, professionalId),
        ),
      )
      .orderBy(asc(professionalShifts.weekday), asc(professionalShifts.startMinute)),
    db
      .select()
      .from(professionalTimeOff)
      .where(
        and(
          eq(professionalTimeOff.tenantId, tenantId),
          eq(professionalTimeOff.professionalId, professionalId),
          // Los bloqueos ya pasados no se listan: la ficha se hace ilegible.
          gte(professionalTimeOff.endsAt, new Date(Date.now() - 30 * 86_400_000)),
        ),
      )
      .orderBy(asc(professionalTimeOff.startsAt)),
    db
      .select({
        treatmentId: professionalTreatments.treatmentId,
        name: treatments.name,
        durationMinutes: treatments.durationMinutes,
        durationOverrideMinutes: professionalTreatments.durationOverrideMinutes,
        active: treatments.active,
      })
      .from(professionalTreatments)
      .innerJoin(treatments, eq(treatments.id, professionalTreatments.treatmentId))
      .where(
        and(
          eq(professionalTreatments.tenantId, tenantId),
          eq(professionalTreatments.professionalId, professionalId),
        ),
      )
      .orderBy(asc(treatments.name)),
    db
      .select({
        id: treatments.id,
        name: treatments.name,
        durationMinutes: treatments.durationMinutes,
        active: treatments.active,
      })
      .from(treatments)
      .where(eq(treatments.tenantId, tenantId))
      .orderBy(asc(treatments.name)),
  ]);

  return {
    professional: row.professional,
    linkedUserEmail: row.linkedUserEmail ?? null,
    shifts,
    timeOff,
    treatments: assigned,
    catalog,
  };
}

/** ¿La clínica ya usa la agenda interna? Es lo que decide si los agentes la consultan. */
export async function tenantHasAgenda(tenantId: string): Promise<boolean> {
  const rows = await db
    .select({ id: professionals.id })
    .from(professionals)
    .where(
      and(
        eq(professionals.tenantId, tenantId),
        eq(professionals.active, true),
        eq(professionals.agendaEnabled, true),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ─── Calendario ──────────────────────────────────────────────────────────────

export interface CalendarAppointment extends AppointmentRow {
  professionalName: string;
  professionalColor: string;
  treatmentName: string | null;
}

export async function listAppointmentsInRange(
  tenantId: string,
  params: { from: Date; to: Date; professionalIds?: string[]; includeCancelled?: boolean },
): Promise<CalendarAppointment[]> {
  const where = [
    eq(agendaAppointments.tenantId, tenantId),
    gte(agendaAppointments.startsAt, params.from),
    lt(agendaAppointments.startsAt, params.to),
  ];
  if (params.professionalIds && params.professionalIds.length > 0) {
    where.push(inArray(agendaAppointments.professionalId, params.professionalIds));
  }
  if (!params.includeCancelled) {
    where.push(ne(agendaAppointments.status, 'CANCELLED'));
  }

  const rows = await db
    .select({
      appointment: agendaAppointments,
      professionalName: professionals.fullName,
      professionalColor: professionals.color,
      treatmentName: treatments.name,
    })
    .from(agendaAppointments)
    .innerJoin(professionals, eq(professionals.id, agendaAppointments.professionalId))
    .leftJoin(treatments, eq(treatments.id, agendaAppointments.treatmentId))
    .where(and(...where))
    .orderBy(asc(agendaAppointments.startsAt));

  return rows.map((r) => ({
    ...r.appointment,
    professionalName: r.professionalName,
    professionalColor: r.professionalColor,
    treatmentName: r.treatmentName ?? null,
  }));
}

export async function listTimeOffInRange(
  tenantId: string,
  params: { from: Date; to: Date; professionalIds?: string[] },
): Promise<TimeOffRow[]> {
  const where = [
    eq(professionalTimeOff.tenantId, tenantId),
    lt(professionalTimeOff.startsAt, params.to),
    gte(professionalTimeOff.endsAt, params.from),
  ];
  if (params.professionalIds && params.professionalIds.length > 0) {
    where.push(inArray(professionalTimeOff.professionalId, params.professionalIds));
  }
  return db
    .select()
    .from(professionalTimeOff)
    .where(and(...where))
    .orderBy(asc(professionalTimeOff.startsAt));
}

export async function getAppointment(
  tenantId: string,
  appointmentId: string,
): Promise<AppointmentRow | null> {
  const rows = await db
    .select()
    .from(agendaAppointments)
    .where(and(eq(agendaAppointments.tenantId, tenantId), eq(agendaAppointments.id, appointmentId)))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Disponibilidad ──────────────────────────────────────────────────────────

export interface AvailabilityParams {
  professionalId: string;
  /** 'YYYY-MM-DD' en hora de la clínica. */
  fromDateKey: string;
  toDateKey: string;
  durationMinutes: number;
  limit?: number;
  now?: Date;
}

export interface AvailabilityResult {
  timezone: string;
  slots: SlotCandidate[];
  /** Motivo por el que no hay huecos, cuando la causa es de configuración. */
  reason: 'OK' | 'NO_PROFESSIONAL' | 'AGENDA_DISABLED' | 'NO_SHIFTS';
}

/**
 * Huecos libres de un profesional. Carga franjas, citas y bloqueos y se lo
 * pasa al motor puro. Las citas se leen con un día de margen a cada lado para
 * que una cita larga que empieza el día anterior siga bloqueando.
 */
export async function getAvailability(
  tenantId: string,
  params: AvailabilityParams,
): Promise<AvailabilityResult> {
  const professional = await getProfessional(tenantId, params.professionalId);
  if (!professional || !professional.active) {
    return { timezone: await getClinicTimezone(tenantId), slots: [], reason: 'NO_PROFESSIONAL' };
  }
  const timezone = await resolveTimezone(tenantId, professional);
  if (!professional.agendaEnabled) {
    return { timezone, slots: [], reason: 'AGENDA_DISABLED' };
  }

  const rangeStart = new Date(`${addDaysToKey(params.fromDateKey, -1)}T00:00:00Z`);
  const rangeEnd = new Date(`${addDaysToKey(params.toDateKey, 2)}T00:00:00Z`);

  const [shiftRows, appointmentRows, blockRows] = await Promise.all([
    db
      .select()
      .from(professionalShifts)
      .where(
        and(
          eq(professionalShifts.tenantId, tenantId),
          eq(professionalShifts.professionalId, params.professionalId),
          eq(professionalShifts.active, true),
        ),
      ),
    db
      .select({ startsAt: agendaAppointments.startsAt, endsAt: agendaAppointments.endsAt })
      .from(agendaAppointments)
      .where(
        and(
          eq(agendaAppointments.tenantId, tenantId),
          eq(agendaAppointments.professionalId, params.professionalId),
          inArray(agendaAppointments.status, BUSY_STATUSES),
          lt(agendaAppointments.startsAt, rangeEnd),
          gte(agendaAppointments.endsAt, rangeStart),
        ),
      ),
    db
      .select({ startsAt: professionalTimeOff.startsAt, endsAt: professionalTimeOff.endsAt })
      .from(professionalTimeOff)
      .where(
        and(
          eq(professionalTimeOff.tenantId, tenantId),
          eq(professionalTimeOff.professionalId, params.professionalId),
          lt(professionalTimeOff.startsAt, rangeEnd),
          gte(professionalTimeOff.endsAt, rangeStart),
        ),
      ),
  ]);

  if (shiftRows.length === 0) {
    return { timezone, slots: [], reason: 'NO_SHIFTS' };
  }

  const options: SlotOptions = {
    timezone,
    durationMinutes: params.durationMinutes,
    granularityMinutes: professional.slotGranularityMinutes,
    bufferMinutes: professional.bufferMinutes,
    minNoticeHours: professional.minNoticeHours,
    maxAdvanceDays: professional.maxAdvanceDays,
    now: params.now ?? new Date(),
  };

  const slots = computeRangeSlots({
    fromDateKey: params.fromDateKey,
    toDateKey: params.toDateKey,
    shifts: shiftRows.map(toShiftRule),
    appointments: appointmentRows.map((a) => ({ start: a.startsAt, end: a.endsAt })),
    blocks: blockRows.map((b) => ({ start: b.startsAt, end: b.endsAt })),
    options,
    limit: params.limit,
  });

  return { timezone, slots, reason: 'OK' };
}

export function toShiftRule(row: ShiftRow): ShiftRule {
  return {
    weekday: row.weekday,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    active: row.active,
  };
}

/** Duración de un tratamiento para un profesional (con su override si lo tiene). */
export async function resolveDuration(
  tenantId: string,
  professionalId: string,
  treatmentId: string | null,
  fallbackMinutes = 30,
): Promise<number> {
  if (!treatmentId) return fallbackMinutes;
  const [row] = await db
    .select({
      base: treatments.durationMinutes,
      override: professionalTreatments.durationOverrideMinutes,
    })
    .from(treatments)
    .leftJoin(
      professionalTreatments,
      and(
        eq(professionalTreatments.treatmentId, treatments.id),
        eq(professionalTreatments.professionalId, professionalId),
      ),
    )
    .where(and(eq(treatments.tenantId, tenantId), eq(treatments.id, treatmentId)))
    .limit(1);
  return row?.override ?? row?.base ?? fallbackMinutes;
}

// ─── Pacientes e historia clínica ────────────────────────────────────────────

export interface PatientSummary {
  patientKey: string;
  patientName: string;
  patientPhone: string | null;
  patientEmail: string | null;
  ghlContactId: string | null;
  totalAppointments: number;
  lastVisitAt: Date | null;
  nextVisitAt: Date | null;
  noteCount: number;
  professionalIds: string[];
}

/**
 * Pacientes vistos desde la agenda. `professionalId` los limita a los de ese
 * profesional — es lo que ve un médico con acceso restringido.
 */
export async function listAgendaPatients(
  tenantId: string,
  opts: { professionalId?: string; search?: string; limit?: number } = {},
): Promise<PatientSummary[]> {
  const where = [eq(agendaAppointments.tenantId, tenantId)];
  if (opts.professionalId) {
    where.push(eq(agendaAppointments.professionalId, opts.professionalId));
  }
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim().toLowerCase()}%`;
    const filter = or(
      sql`lower(${agendaAppointments.patientName}) like ${q}`,
      sql`lower(coalesce(${agendaAppointments.patientPhone}, '')) like ${q}`,
      sql`lower(coalesce(${agendaAppointments.patientEmail}, '')) like ${q}`,
    );
    if (filter) where.push(filter);
  }

  // Va como ISO con cast explícito: dentro de un fragmento `sql` crudo, el
  // driver no sabe el tipo del parámetro y una Date suelta revienta el bind.
  const now = new Date().toISOString();
  const rows = await db
    .select({
      patientKey: agendaAppointments.patientKey,
      patientName: sql<string>`max(${agendaAppointments.patientName})`,
      patientPhone: sql<string | null>`max(${agendaAppointments.patientPhone})`,
      patientEmail: sql<string | null>`max(${agendaAppointments.patientEmail})`,
      ghlContactId: sql<string | null>`max(${agendaAppointments.ghlContactId})`,
      totalAppointments: sql<number>`count(*)`,
      lastVisitAt: sql<Date | null>`max(${agendaAppointments.startsAt}) filter (where ${agendaAppointments.startsAt} < ${now}::timestamptz)`,
      nextVisitAt: sql<Date | null>`min(${agendaAppointments.startsAt}) filter (where ${agendaAppointments.startsAt} >= ${now}::timestamptz and ${agendaAppointments.status} <> 'CANCELLED')`,
      professionalIds: sql<string[]>`array_agg(distinct ${agendaAppointments.professionalId})`,
    })
    .from(agendaAppointments)
    .where(and(...where))
    .groupBy(agendaAppointments.patientKey)
    .orderBy(sql`max(${agendaAppointments.startsAt}) desc`)
    .limit(opts.limit ?? 200);

  if (rows.length === 0) return [];

  const noteCounts = await db
    .select({ patientKey: clinicalNotes.patientKey, n: sql<number>`count(*)` })
    .from(clinicalNotes)
    .where(
      and(
        eq(clinicalNotes.tenantId, tenantId),
        inArray(
          clinicalNotes.patientKey,
          rows.map((r) => r.patientKey),
        ),
        ...(opts.professionalId ? [eq(clinicalNotes.professionalId, opts.professionalId)] : []),
      ),
    )
    .groupBy(clinicalNotes.patientKey);
  const noteMap = new Map(noteCounts.map((n) => [n.patientKey, Number(n.n)]));

  return rows.map((r) => ({
    patientKey: r.patientKey,
    patientName: r.patientName,
    patientPhone: r.patientPhone,
    patientEmail: r.patientEmail,
    ghlContactId: r.ghlContactId,
    totalAppointments: Number(r.totalAppointments),
    lastVisitAt: r.lastVisitAt ? new Date(r.lastVisitAt) : null,
    nextVisitAt: r.nextVisitAt ? new Date(r.nextVisitAt) : null,
    noteCount: noteMap.get(r.patientKey) ?? 0,
    professionalIds: r.professionalIds ?? [],
  }));
}

export interface PatientDossier {
  patientKey: string;
  patientName: string;
  patientPhone: string | null;
  patientEmail: string | null;
  ghlContactId: string | null;
  appointments: CalendarAppointment[];
  notes: (ClinicalNoteRow & { professionalName: string; authorEmail: string | null })[];
}

/**
 * Ficha del paciente: sus citas y su historia clínica.
 *
 * `viewerProfessionalId` acota lo que se devuelve cuando quien mira es un
 * profesional con acceso restringido, y `includePrivate` decide si se le
 * enseñan las notas marcadas como privadas (sólo a su autor).
 */
export async function getPatientDossier(
  tenantId: string,
  patientKey: string,
  opts: { viewerProfessionalId?: string | null } = {},
): Promise<PatientDossier | null> {
  const apptWhere = [
    eq(agendaAppointments.tenantId, tenantId),
    eq(agendaAppointments.patientKey, patientKey),
  ];
  if (opts.viewerProfessionalId) {
    apptWhere.push(eq(agendaAppointments.professionalId, opts.viewerProfessionalId));
  }

  const appointmentRows = await db
    .select({
      appointment: agendaAppointments,
      professionalName: professionals.fullName,
      professionalColor: professionals.color,
      treatmentName: treatments.name,
    })
    .from(agendaAppointments)
    .innerJoin(professionals, eq(professionals.id, agendaAppointments.professionalId))
    .leftJoin(treatments, eq(treatments.id, agendaAppointments.treatmentId))
    .where(and(...apptWhere))
    .orderBy(desc(agendaAppointments.startsAt))
    .limit(200);

  if (appointmentRows.length === 0) return null;

  const noteWhere = [
    eq(clinicalNotes.tenantId, tenantId),
    eq(clinicalNotes.patientKey, patientKey),
  ];
  if (opts.viewerProfessionalId) {
    noteWhere.push(eq(clinicalNotes.professionalId, opts.viewerProfessionalId));
  }

  const noteRows = await db
    .select({
      note: clinicalNotes,
      professionalName: professionals.fullName,
      authorEmail: users.email,
    })
    .from(clinicalNotes)
    .innerJoin(professionals, eq(professionals.id, clinicalNotes.professionalId))
    .leftJoin(users, eq(users.id, clinicalNotes.authorUserId))
    .where(and(...noteWhere))
    .orderBy(desc(clinicalNotes.createdAt))
    .limit(200);

  const head = appointmentRows[0]?.appointment;
  if (!head) return null;

  return {
    patientKey,
    patientName: head.patientName,
    patientPhone: head.patientPhone,
    patientEmail: head.patientEmail,
    ghlContactId: head.ghlContactId,
    appointments: appointmentRows.map((r) => ({
      ...r.appointment,
      professionalName: r.professionalName,
      professionalColor: r.professionalColor,
      treatmentName: r.treatmentName ?? null,
    })),
    notes: noteRows.map((r) => ({
      ...r.note,
      professionalName: r.professionalName,
      authorEmail: r.authorEmail ?? null,
    })),
  };
}
