import 'server-only';
import { and, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { AgendaContext } from '@/lib/agenda/auth';
import { describeConflict, isInsideWorkingHours } from '@/lib/agenda/availability';
import { normalizePatientPhone, patientKeyFor } from '@/lib/agenda/patients';
import {
  getProfessional,
  resolveDuration,
  resolveTimezone,
  toShiftRule,
} from '@/lib/agenda/queries';
import { BUSY_STATUSES, PROFESSIONAL_COLORS } from '@/lib/agenda/shared';
import { db } from '@/lib/db/client';
import {
  agendaAppointments,
  clinicalNotes,
  professionalShifts,
  professionalTimeOff,
  professionalTreatments,
  professionals,
  treatments,
  users,
} from '@/lib/db/schema';
import { zonedToUtc } from '@/lib/tasks/tz';

export class AgendaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgendaValidationError';
  }
}

// ─── Esquemas ────────────────────────────────────────────────────────────────

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'El color debe ser un hexadecimal tipo #37766a');

export const professionalInputSchema = z.object({
  fullName: z.string().trim().min(2, 'El nombre es obligatorio').max(120),
  email: z.string().trim().email('Email inválido').max(160).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  specialty: z.string().trim().max(120).optional().or(z.literal('')),
  licenseNumber: z.string().trim().max(60).optional().or(z.literal('')),
  color: hexColor.optional(),
  active: z.boolean().optional(),
  agendaEnabled: z.boolean().optional(),
  panelAccess: z.enum(['AGENDA_ONLY', 'FULL']).optional(),
  timezone: z.string().trim().max(60).optional().or(z.literal('')),
  slotGranularityMinutes: z.number().int().min(5).max(120).optional(),
  bufferMinutes: z.number().int().min(0).max(120).optional(),
  minNoticeHours: z.number().int().min(0).max(720).optional(),
  maxAdvanceDays: z.number().int().min(1).max(365).optional(),
  acceptsOnlineBooking: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  /** Email del usuario de la plataforma al que se vincula (o null para desvincular). */
  linkUserEmail: z.string().trim().email().max(160).nullable().optional(),
});

export type ProfessionalInput = z.infer<typeof professionalInputSchema>;

export const shiftInputSchema = z.object({
  weekday: z.number().int().min(1).max(7),
  startMinute: z.number().int().min(0).max(1440),
  endMinute: z.number().int().min(0).max(1440),
  validFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  validUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

// Igual que las citas: el bloqueo se puede dar como instante ISO o como día +
// minuto LOCAL de la clínica. Lo segundo es lo que manda el panel — un "no
// vengo el martes" tiene que empezar a las 00:00 de la clínica, no a las 00:00
// del servidor, que corre en UTC.
export const timeOffInputSchema = z
  .object({
    startsAt: z.string().min(1).optional(),
    endsAt: z.string().min(1).optional(),
    startDateKey: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    startMinute: z.number().int().min(0).max(1440).optional(),
    endDateKey: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    endMinute: z.number().int().min(0).max(1440).optional(),
    allDay: z.boolean().optional(),
    kind: z.enum(['TIME_OFF', 'HOLIDAY', 'BREAK', 'OTHER']).optional(),
    reason: z.string().trim().max(300).optional().or(z.literal('')),
  })
  .refine(
    (v) => (v.startsAt && v.endsAt) || (v.startDateKey !== undefined && v.endDateKey !== undefined),
    { message: 'Faltan las fechas del bloqueo.' },
  );

export const appointmentInputSchema = z.object({
  professionalId: z.string().uuid(),
  treatmentId: z.string().uuid().nullable().optional(),
  patientName: z.string().trim().min(2, 'El nombre del paciente es obligatorio').max(160),
  patientPhone: z.string().trim().max(40).optional().or(z.literal('')),
  patientEmail: z.string().trim().max(160).optional().or(z.literal('')),
  ghlContactId: z.string().trim().max(60).optional().or(z.literal('')),
  // El inicio se puede dar de dos formas: como instante ISO (lo que mandan los
  // agentes, que ya hablan en UTC) o como día + minuto LOCAL de la clínica (lo
  // que sabe el calendario del panel). La segunda evita que el navegador, que
  // puede estar en otra zona, tenga que convertir nada.
  startsAt: z.string().min(1).optional(),
  startDateKey: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  startMinute: z.number().int().min(0).max(1439).optional(),
  /** Si no se manda, se calcula con la duración del tratamiento. */
  durationMinutes: z.number().int().min(5).max(600).optional(),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  status: z
    .enum(['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])
    .optional(),
  source: z.enum(['PANEL', 'VOICE_AGENT', 'WHATSAPP_AGENT', 'WAITLIST', 'IMPORT']).optional(),
  /** Encajar fuera del horario del profesional (sólo desde el panel, a sabiendas). */
  allowOutsideHours: z.boolean().optional(),
  dedupeKey: z.string().trim().max(200).optional(),
});

export type AppointmentInput = z.infer<typeof appointmentInputSchema>;

export const clinicalNoteInputSchema = z.object({
  appointmentId: z.string().uuid().nullable().optional(),
  professionalId: z.string().uuid(),
  patientKey: z.string().trim().min(1).max(200),
  patientName: z.string().trim().max(160).optional().or(z.literal('')),
  summary: z.string().trim().min(3, 'Escribe al menos el motivo de la consulta').max(4000),
  treatmentPerformed: z.string().trim().max(2000).optional().or(z.literal('')),
  observations: z.string().trim().max(4000).optional().or(z.literal('')),
  nextSteps: z.string().trim().max(2000).optional().or(z.literal('')),
  private: z.boolean().optional(),
});

// ─── Profesionales ───────────────────────────────────────────────────────────

function emptyToNull(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/** users.id del email indicado, sólo si ese usuario es miembro del tenant. */
async function resolveLinkedUser(tenantId: string, email: string): Promise<string> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  const user = rows[0];
  if (!user) {
    throw new AgendaValidationError(
      'Ese email no tiene todavía usuario en la plataforma. Invítalo desde Equipo y vuelve a vincularlo.',
    );
  }
  // El id de usuario llega del cliente: hay que comprobar que pertenece a esta
  // clínica antes de darle acceso a su agenda y a sus pacientes.
  const membership = await db.execute(
    sql`select 1 from tenant_memberships where tenant_id = ${tenantId} and user_id = ${user.id} limit 1`,
  );
  if (membership.length === 0) {
    throw new AgendaValidationError('Ese usuario no pertenece a esta clínica.');
  }
  return user.id;
}

export async function createProfessional(ctx: AgendaContext, raw: ProfessionalInput) {
  const input = professionalInputSchema.parse(raw);

  const existing = await db
    .select({ n: sql<number>`count(*)` })
    .from(professionals)
    .where(eq(professionals.tenantId, ctx.tenantId));
  const index = Number(existing[0]?.n ?? 0);

  const userId = input.linkUserEmail
    ? await resolveLinkedUser(ctx.tenantId, input.linkUserEmail)
    : null;

  const [row] = await db
    .insert(professionals)
    .values({
      tenantId: ctx.tenantId,
      userId,
      fullName: input.fullName,
      email: emptyToNull(input.email),
      phone: emptyToNull(input.phone),
      specialty: emptyToNull(input.specialty),
      licenseNumber: emptyToNull(input.licenseNumber),
      color: input.color ?? PROFESSIONAL_COLORS[index % PROFESSIONAL_COLORS.length],
      active: input.active ?? true,
      agendaEnabled: input.agendaEnabled ?? false,
      panelAccess: input.panelAccess ?? 'AGENDA_ONLY',
      timezone: emptyToNull(input.timezone),
      slotGranularityMinutes: input.slotGranularityMinutes ?? 15,
      bufferMinutes: input.bufferMinutes ?? 0,
      minNoticeHours: input.minNoticeHours ?? 2,
      maxAdvanceDays: input.maxAdvanceDays ?? 90,
      acceptsOnlineBooking: input.acceptsOnlineBooking ?? true,
      notes: emptyToNull(input.notes),
    })
    .returning();

  return row;
}

export async function updateProfessional(
  ctx: AgendaContext,
  professionalId: string,
  raw: Partial<ProfessionalInput>,
) {
  const input = professionalInputSchema.partial().parse(raw);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.fullName !== undefined) patch.fullName = input.fullName;
  if (input.email !== undefined) patch.email = emptyToNull(input.email);
  if (input.phone !== undefined) patch.phone = emptyToNull(input.phone);
  if (input.specialty !== undefined) patch.specialty = emptyToNull(input.specialty);
  if (input.licenseNumber !== undefined) patch.licenseNumber = emptyToNull(input.licenseNumber);
  if (input.color !== undefined) patch.color = input.color;
  if (input.active !== undefined) patch.active = input.active;
  if (input.agendaEnabled !== undefined) patch.agendaEnabled = input.agendaEnabled;
  if (input.panelAccess !== undefined) patch.panelAccess = input.panelAccess;
  if (input.timezone !== undefined) patch.timezone = emptyToNull(input.timezone);
  if (input.slotGranularityMinutes !== undefined)
    patch.slotGranularityMinutes = input.slotGranularityMinutes;
  if (input.bufferMinutes !== undefined) patch.bufferMinutes = input.bufferMinutes;
  if (input.minNoticeHours !== undefined) patch.minNoticeHours = input.minNoticeHours;
  if (input.maxAdvanceDays !== undefined) patch.maxAdvanceDays = input.maxAdvanceDays;
  if (input.acceptsOnlineBooking !== undefined)
    patch.acceptsOnlineBooking = input.acceptsOnlineBooking;
  if (input.notes !== undefined) patch.notes = emptyToNull(input.notes);
  if (input.linkUserEmail !== undefined) {
    patch.userId = input.linkUserEmail
      ? await resolveLinkedUser(ctx.tenantId, input.linkUserEmail)
      : null;
  }

  const [row] = await db
    .update(professionals)
    .set(patch)
    .where(and(eq(professionals.tenantId, ctx.tenantId), eq(professionals.id, professionalId)))
    .returning();

  if (!row) throw new AgendaValidationError('Ese profesional no existe en esta clínica.');
  return row;
}

/** Baja lógica. No se borra: sus citas y sus notas son historia clínica. */
export async function deactivateProfessional(ctx: AgendaContext, professionalId: string) {
  return updateProfessional(ctx, professionalId, { active: false, agendaEnabled: false });
}

/** Vuelve a dar de alta a quien estaba de baja. La agenda queda apagada. */
export async function reactivateProfessional(ctx: AgendaContext, professionalId: string) {
  return updateProfessional(ctx, professionalId, { active: true });
}

export interface ProfessionalDeletionPreview {
  fullName: string;
  appointments: number;
  notes: number;
  /** Sin nada colgando se puede borrar de verdad; con historia, no. */
  canDelete: boolean;
}

/**
 * Qué pasaría si se borrara este profesional.
 *
 * `agenda_appointments` y `clinical_notes` cuelgan de `professionals` con
 * ON DELETE CASCADE, así que borrar a alguien con historial se llevaría por
 * delante la historia clínica de sus pacientes. Eso no puede quedar a un clic:
 * si tiene algo, la salida es darlo de baja.
 */
export async function previewProfessionalDeletion(
  ctx: AgendaContext,
  professionalId: string,
): Promise<ProfessionalDeletionPreview> {
  const professional = await getProfessional(ctx.tenantId, professionalId);
  if (!professional) throw new AgendaValidationError('Ese profesional no existe en esta clínica.');

  const [citas, notas] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)` })
      .from(agendaAppointments)
      .where(
        and(
          eq(agendaAppointments.tenantId, ctx.tenantId),
          eq(agendaAppointments.professionalId, professionalId),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)` })
      .from(clinicalNotes)
      .where(
        and(
          eq(clinicalNotes.tenantId, ctx.tenantId),
          eq(clinicalNotes.professionalId, professionalId),
        ),
      ),
  ]);

  const appointments = Number(citas[0]?.n ?? 0);
  const notes = Number(notas[0]?.n ?? 0);

  return {
    fullName: professional.fullName,
    appointments,
    notes,
    canDelete: appointments === 0 && notes === 0,
  };
}

/**
 * Borra al profesional, pero sólo si no arrastra historia.
 *
 * Un alta equivocada se deshace; una carrera de tres años no se borra con un
 * botón. Quien tenga citas o notas se da de baja (`deactivateProfessional`):
 * desaparece de la agenda y de lo que ofrecen los agentes, y su historia sigue
 * en la ficha de cada paciente.
 */
export async function deleteProfessional(ctx: AgendaContext, professionalId: string) {
  const preview = await previewProfessionalDeletion(ctx, professionalId);
  if (!preview.canDelete) {
    const partes = [
      preview.appointments > 0 ? `${preview.appointments} cita(s)` : null,
      preview.notes > 0 ? `${preview.notes} nota(s) clínica(s)` : null,
    ].filter(Boolean);
    throw new AgendaValidationError(
      `${preview.fullName} tiene ${partes.join(' y ')} en la clínica. No se borra para no perder la historia clínica: dale de baja y dejará de aparecer en la agenda.`,
    );
  }

  const [row] = await db
    .delete(professionals)
    .where(and(eq(professionals.tenantId, ctx.tenantId), eq(professionals.id, professionalId)))
    .returning({ id: professionals.id, fullName: professionals.fullName });

  if (!row) throw new AgendaValidationError('Ese profesional ya no existe.');
  return row;
}

export async function setProfessionalTreatments(
  ctx: AgendaContext,
  professionalId: string,
  items: { treatmentId: string; durationOverrideMinutes?: number | null }[],
) {
  // Los ids llegan del cliente: sólo se aceptan tratamientos de este tenant.
  const ids = items.map((i) => i.treatmentId);
  const valid =
    ids.length === 0
      ? []
      : await db
          .select({ id: treatments.id })
          .from(treatments)
          .where(and(eq(treatments.tenantId, ctx.tenantId), inArray(treatments.id, ids)));
  const validIds = new Set(valid.map((v) => v.id));

  await db.transaction(async (tx) => {
    await tx
      .delete(professionalTreatments)
      .where(
        and(
          eq(professionalTreatments.tenantId, ctx.tenantId),
          eq(professionalTreatments.professionalId, professionalId),
        ),
      );

    const rows = items
      .filter((i) => validIds.has(i.treatmentId))
      .map((i) => ({
        tenantId: ctx.tenantId,
        professionalId,
        treatmentId: i.treatmentId,
        durationOverrideMinutes: i.durationOverrideMinutes ?? null,
      }));
    if (rows.length > 0) await tx.insert(professionalTreatments).values(rows);
  });

  return { count: items.filter((i) => validIds.has(i.treatmentId)).length };
}

export type ShiftInput = z.infer<typeof shiftInputSchema>;

/**
 * Reemplaza el horario semanal completo. Es lo que manda el editor de la ficha:
 * un PATCH parcial de franjas sueltas daría lugar a horarios a medias si una
 * petición se pierde.
 */
export async function replaceShifts(
  ctx: AgendaContext,
  professionalId: string,
  rawShifts: ShiftInput[],
) {
  const shifts = rawShifts.map((s) => shiftInputSchema.parse(s));

  for (const s of shifts) {
    if (s.endMinute <= s.startMinute) {
      throw new AgendaValidationError('Una franja no puede terminar antes de empezar.');
    }
  }
  // Franjas del mismo día que se pisan: casi siempre es un error de carga y
  // deja huecos duplicados.
  for (const day of new Set(shifts.map((s) => s.weekday))) {
    const ofDay = shifts
      .filter((s) => s.weekday === day)
      .sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 1; i < ofDay.length; i++) {
      const prev = ofDay[i - 1];
      const cur = ofDay[i];
      if (prev && cur && cur.startMinute < prev.endMinute) {
        throw new AgendaValidationError('Hay dos franjas que se solapan el mismo día.');
      }
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(professionalShifts)
      .where(
        and(
          eq(professionalShifts.tenantId, ctx.tenantId),
          eq(professionalShifts.professionalId, professionalId),
        ),
      );
    if (shifts.length > 0) {
      await tx.insert(professionalShifts).values(
        shifts.map((s) => ({
          tenantId: ctx.tenantId,
          professionalId,
          weekday: s.weekday,
          startMinute: s.startMinute,
          endMinute: s.endMinute,
          validFrom: s.validFrom ?? null,
          validUntil: s.validUntil ?? null,
          active: true,
        })),
      );
    }
  });

  return { count: shifts.length };
}

export async function addTimeOff(
  ctx: AgendaContext,
  professionalId: string,
  raw: z.infer<typeof timeOffInputSchema>,
) {
  const input = timeOffInputSchema.parse(raw);

  const professional = await getProfessional(ctx.tenantId, professionalId);
  if (!professional) throw new AgendaValidationError('Ese profesional no existe en esta clínica.');
  const timezone = await resolveTimezone(ctx.tenantId, professional);

  const startsAt = resolveStart(
    {
      startsAt: input.startsAt,
      startDateKey: input.startDateKey,
      startMinute: input.startMinute ?? 0,
    },
    timezone,
  );
  const endsAt = resolveStart(
    {
      startsAt: input.endsAt,
      startDateKey: input.endDateKey,
      startMinute: input.endMinute ?? 1440,
    },
    timezone,
  );
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new AgendaValidationError('El bloqueo no puede terminar antes de empezar.');
  }

  const [row] = await db
    .insert(professionalTimeOff)
    .values({
      tenantId: ctx.tenantId,
      professionalId,
      startsAt,
      endsAt,
      allDay: input.allDay ?? false,
      kind: input.kind ?? 'TIME_OFF',
      reason: emptyToNull(input.reason),
      createdByUserId: ctx.userId,
    })
    .returning();

  // Las citas que caen dentro del bloqueo NO se borran: se avisa de cuántas
  // hay para que la clínica decida a quién llama.
  const clashes = await db
    .select({ n: sql<number>`count(*)` })
    .from(agendaAppointments)
    .where(
      and(
        eq(agendaAppointments.tenantId, ctx.tenantId),
        eq(agendaAppointments.professionalId, professionalId),
        inArray(agendaAppointments.status, BUSY_STATUSES),
        lt(agendaAppointments.startsAt, endsAt),
        gte(agendaAppointments.endsAt, startsAt),
      ),
    );

  return { block: row, conflictingAppointments: Number(clashes[0]?.n ?? 0) };
}

export async function removeTimeOff(ctx: AgendaContext, blockId: string) {
  const [row] = await db
    .delete(professionalTimeOff)
    .where(and(eq(professionalTimeOff.tenantId, ctx.tenantId), eq(professionalTimeOff.id, blockId)))
    .returning({ id: professionalTimeOff.id, professionalId: professionalTimeOff.professionalId });
  if (!row) throw new AgendaValidationError('Ese bloqueo ya no existe.');
  return row;
}

// ─── Citas ───────────────────────────────────────────────────────────────────

/**
 * Instante de inicio, venga como ISO o como día + minuto local de la clínica.
 * `zonedToUtc` hace la doble pasada del cambio de horario, así que "el 26 de
 * octubre a las 10:00" es las 10:00 también el día que cambia la hora.
 */
function resolveStart(
  input: { startsAt?: string; startDateKey?: string; startMinute?: number },
  timezone: string,
): Date {
  if (input.startsAt) {
    const d = new Date(input.startsAt);
    if (Number.isNaN(d.getTime())) {
      throw new AgendaValidationError(`Fecha de inicio inválida: "${input.startsAt}".`);
    }
    return d;
  }
  if (input.startDateKey && input.startMinute !== undefined) {
    const [y, m, d] = input.startDateKey.split('-').map(Number);
    if (!y || !m || !d) throw new AgendaValidationError('Fecha de inicio inválida.');
    return zonedToUtc(
      y,
      m,
      d,
      Math.floor(input.startMinute / 60),
      input.startMinute % 60,
      timezone,
    );
  }
  throw new AgendaValidationError('Falta la fecha de inicio de la cita.');
}

/**
 * Serializa las escrituras de la agenda de UN profesional.
 *
 * Sin esto, dos reservas simultáneas (la recepcionista y el agente de voz, que
 * es el caso real) leen la agenda libre a la vez y las dos escriben: el
 * paciente se encuentra a otro sentado en el sillón. El lock es de transacción,
 * así que se suelta solo al terminar o al fallar.
 */
async function withProfessionalLock<T>(
  professionalId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${professionalId}))`);
    return fn(tx);
  });
}

export interface CreateAppointmentResult {
  appointment: typeof agendaAppointments.$inferSelect;
  /** true si se devolvió una cita que ya existía (dedupe). */
  deduped: boolean;
}

export async function createAppointment(
  ctx: AgendaContext,
  raw: AppointmentInput,
): Promise<CreateAppointmentResult> {
  const input = appointmentInputSchema.parse(raw);

  const professional = await getProfessional(ctx.tenantId, input.professionalId);
  if (!professional || !professional.active) {
    throw new AgendaValidationError('Ese profesional no existe o está dado de baja.');
  }
  if (!professional.agendaEnabled) {
    throw new AgendaValidationError(
      `La agenda de ${professional.fullName} está deshabilitada. Actívala antes de agendarle citas.`,
    );
  }

  const timezone = await resolveTimezone(ctx.tenantId, professional);
  const startsAt = resolveStart(input, timezone);

  const duration =
    input.durationMinutes ??
    (await resolveDuration(ctx.tenantId, professional.id, input.treatmentId ?? null));
  const endsAt = new Date(startsAt.getTime() + duration * 60_000);

  // El tratamiento llega del cliente: se comprueba que es de este tenant antes
  // de guardarlo (y de usar su duración).
  if (input.treatmentId) {
    const rows = await db
      .select({ id: treatments.id })
      .from(treatments)
      .where(and(eq(treatments.tenantId, ctx.tenantId), eq(treatments.id, input.treatmentId)))
      .limit(1);
    if (rows.length === 0) {
      throw new AgendaValidationError('Ese tratamiento no existe en esta clínica.');
    }
  }

  const phone = normalizePatientPhone(input.patientPhone) ?? emptyToNull(input.patientPhone);
  const patientKey = patientKeyFor({
    ghlContactId: input.ghlContactId,
    phone,
    email: input.patientEmail,
    name: input.patientName,
  });

  return withProfessionalLock(professional.id, async (tx) => {
    if (input.dedupeKey) {
      const existing = await tx
        .select()
        .from(agendaAppointments)
        .where(
          and(
            eq(agendaAppointments.tenantId, ctx.tenantId),
            eq(agendaAppointments.dedupeKey, input.dedupeKey),
          ),
        )
        .limit(1);
      const already = existing[0];
      if (already) return { appointment: already, deduped: true as const };
    }

    const busy = await tx
      .select({ startsAt: agendaAppointments.startsAt, endsAt: agendaAppointments.endsAt })
      .from(agendaAppointments)
      .where(
        and(
          eq(agendaAppointments.tenantId, ctx.tenantId),
          eq(agendaAppointments.professionalId, professional.id),
          inArray(agendaAppointments.status, BUSY_STATUSES),
          lt(agendaAppointments.startsAt, new Date(endsAt.getTime() + 12 * 3_600_000)),
          gte(agendaAppointments.endsAt, new Date(startsAt.getTime() - 12 * 3_600_000)),
        ),
      );

    const blocks = await tx
      .select({ startsAt: professionalTimeOff.startsAt, endsAt: professionalTimeOff.endsAt })
      .from(professionalTimeOff)
      .where(
        and(
          eq(professionalTimeOff.tenantId, ctx.tenantId),
          eq(professionalTimeOff.professionalId, professional.id),
          lt(professionalTimeOff.startsAt, endsAt),
          gte(professionalTimeOff.endsAt, startsAt),
        ),
      );

    const conflict = describeConflict(
      startsAt,
      endsAt,
      busy.map((b) => ({ start: b.startsAt, end: b.endsAt })),
      blocks.map((b) => ({ start: b.startsAt, end: b.endsAt })),
      professional.bufferMinutes,
    );
    if (conflict) throw new AgendaValidationError(conflict);

    if (!input.allowOutsideHours) {
      const shiftRows = await tx
        .select()
        .from(professionalShifts)
        .where(
          and(
            eq(professionalShifts.tenantId, ctx.tenantId),
            eq(professionalShifts.professionalId, professional.id),
            eq(professionalShifts.active, true),
          ),
        );
      const inside = isInsideWorkingHours(startsAt, endsAt, shiftRows.map(toShiftRule), timezone);
      if (!inside) {
        throw new AgendaValidationError(
          `Ese horario cae fuera del horario de trabajo de ${professional.fullName}.`,
        );
      }
    }

    const [row] = await tx
      .insert(agendaAppointments)
      .values({
        tenantId: ctx.tenantId,
        professionalId: professional.id,
        treatmentId: input.treatmentId ?? null,
        patientKey,
        patientName: input.patientName,
        patientPhone: phone,
        patientEmail: emptyToNull(input.patientEmail),
        ghlContactId: emptyToNull(input.ghlContactId),
        startsAt,
        endsAt,
        status: input.status ?? 'SCHEDULED',
        source: input.source ?? 'PANEL',
        notes: emptyToNull(input.notes),
        createdByUserId: ctx.userId,
        dedupeKey: input.dedupeKey ?? null,
      })
      .returning();
    if (!row) throw new AgendaValidationError('No se pudo guardar la cita.');

    return { appointment: row, deduped: false as const };
  });
}

export async function rescheduleAppointment(
  ctx: AgendaContext,
  appointmentId: string,
  params: {
    startsAt?: string;
    startDateKey?: string;
    startMinute?: number;
    durationMinutes?: number;
    professionalId?: string;
    allowOutsideHours?: boolean;
  },
) {
  const [current] = await db
    .select()
    .from(agendaAppointments)
    .where(
      and(eq(agendaAppointments.tenantId, ctx.tenantId), eq(agendaAppointments.id, appointmentId)),
    )
    .limit(1);
  if (!current) throw new AgendaValidationError('Esa cita ya no existe.');

  const professionalId = params.professionalId ?? current.professionalId;
  const professional = await getProfessional(ctx.tenantId, professionalId);
  if (!professional) throw new AgendaValidationError('Ese profesional no existe en esta clínica.');

  const timezone = await resolveTimezone(ctx.tenantId, professional);
  const startsAt = resolveStart(params, timezone);
  const duration =
    params.durationMinutes ??
    Math.round((current.endsAt.getTime() - current.startsAt.getTime()) / 60_000);
  const endsAt = new Date(startsAt.getTime() + duration * 60_000);

  return withProfessionalLock(professionalId, async (tx) => {
    const busy = await tx
      .select({ startsAt: agendaAppointments.startsAt, endsAt: agendaAppointments.endsAt })
      .from(agendaAppointments)
      .where(
        and(
          eq(agendaAppointments.tenantId, ctx.tenantId),
          eq(agendaAppointments.professionalId, professionalId),
          inArray(agendaAppointments.status, BUSY_STATUSES),
          // La propia cita no se cuenta como conflicto consigo misma.
          ne(agendaAppointments.id, appointmentId),
          lt(agendaAppointments.startsAt, new Date(endsAt.getTime() + 12 * 3_600_000)),
          gte(agendaAppointments.endsAt, new Date(startsAt.getTime() - 12 * 3_600_000)),
        ),
      );

    const blocks = await tx
      .select({ startsAt: professionalTimeOff.startsAt, endsAt: professionalTimeOff.endsAt })
      .from(professionalTimeOff)
      .where(
        and(
          eq(professionalTimeOff.tenantId, ctx.tenantId),
          eq(professionalTimeOff.professionalId, professionalId),
          lt(professionalTimeOff.startsAt, endsAt),
          gte(professionalTimeOff.endsAt, startsAt),
        ),
      );

    const conflict = describeConflict(
      startsAt,
      endsAt,
      busy.map((b) => ({ start: b.startsAt, end: b.endsAt })),
      blocks.map((b) => ({ start: b.startsAt, end: b.endsAt })),
      professional.bufferMinutes,
    );
    if (conflict) throw new AgendaValidationError(conflict);

    if (!params.allowOutsideHours) {
      const shiftRows = await tx
        .select()
        .from(professionalShifts)
        .where(
          and(
            eq(professionalShifts.tenantId, ctx.tenantId),
            eq(professionalShifts.professionalId, professionalId),
            eq(professionalShifts.active, true),
          ),
        );
      if (!isInsideWorkingHours(startsAt, endsAt, shiftRows.map(toShiftRule), timezone)) {
        throw new AgendaValidationError(
          `Ese horario cae fuera del horario de trabajo de ${professional.fullName}.`,
        );
      }
    }

    const [row] = await tx
      .update(agendaAppointments)
      .set({ startsAt, endsAt, professionalId, updatedAt: new Date() })
      .where(
        and(
          eq(agendaAppointments.tenantId, ctx.tenantId),
          eq(agendaAppointments.id, appointmentId),
        ),
      )
      .returning();
    return row;
  });
}

export async function updateAppointment(
  ctx: AgendaContext,
  appointmentId: string,
  patch: {
    status?:
      | 'SCHEDULED'
      | 'CONFIRMED'
      | 'ARRIVED'
      | 'IN_PROGRESS'
      | 'COMPLETED'
      | 'CANCELLED'
      | 'NO_SHOW';
    notes?: string | null;
    cancelReason?: string | null;
    patientName?: string;
    patientPhone?: string | null;
    treatmentId?: string | null;
  },
) {
  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.notes !== undefined) values.notes = emptyToNull(patch.notes);
  if (patch.cancelReason !== undefined) values.cancelReason = emptyToNull(patch.cancelReason);
  if (patch.patientName !== undefined) values.patientName = patch.patientName;
  if (patch.patientPhone !== undefined) {
    values.patientPhone =
      normalizePatientPhone(patch.patientPhone) ?? emptyToNull(patch.patientPhone);
  }
  if (patch.treatmentId !== undefined) {
    if (patch.treatmentId) {
      const rows = await db
        .select({ id: treatments.id })
        .from(treatments)
        .where(and(eq(treatments.tenantId, ctx.tenantId), eq(treatments.id, patch.treatmentId)))
        .limit(1);
      if (rows.length === 0) {
        throw new AgendaValidationError('Ese tratamiento no existe en esta clínica.');
      }
    }
    values.treatmentId = patch.treatmentId;
  }

  const [row] = await db
    .update(agendaAppointments)
    .set(values)
    .where(
      and(eq(agendaAppointments.tenantId, ctx.tenantId), eq(agendaAppointments.id, appointmentId)),
    )
    .returning();
  if (!row) throw new AgendaValidationError('Esa cita ya no existe.');
  return row;
}

export async function cancelAppointment(
  ctx: AgendaContext,
  appointmentId: string,
  reason?: string,
) {
  return updateAppointment(ctx, appointmentId, {
    status: 'CANCELLED',
    cancelReason: reason ?? null,
  });
}

// ─── Historia clínica ────────────────────────────────────────────────────────

export async function saveClinicalNote(
  ctx: AgendaContext,
  raw: z.infer<typeof clinicalNoteInputSchema>,
  noteId?: string,
) {
  const input = clinicalNoteInputSchema.parse(raw);

  if (input.appointmentId) {
    // La cita tiene que ser de este tenant Y de ese profesional: si no,
    // cualquiera podría colgarle una nota a la cita de otra clínica.
    const rows = await db
      .select({ id: agendaAppointments.id })
      .from(agendaAppointments)
      .where(
        and(
          eq(agendaAppointments.tenantId, ctx.tenantId),
          eq(agendaAppointments.id, input.appointmentId),
          eq(agendaAppointments.professionalId, input.professionalId),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      throw new AgendaValidationError('Esa cita no es de este profesional.');
    }
  }

  if (noteId) {
    const [row] = await db
      .update(clinicalNotes)
      .set({
        summary: input.summary,
        treatmentPerformed: emptyToNull(input.treatmentPerformed),
        observations: emptyToNull(input.observations),
        nextSteps: emptyToNull(input.nextSteps),
        private: input.private ?? false,
        updatedAt: new Date(),
      })
      .where(and(eq(clinicalNotes.tenantId, ctx.tenantId), eq(clinicalNotes.id, noteId)))
      .returning();
    if (!row) throw new AgendaValidationError('Esa nota ya no existe.');
    return row;
  }

  const [row] = await db
    .insert(clinicalNotes)
    .values({
      tenantId: ctx.tenantId,
      professionalId: input.professionalId,
      appointmentId: input.appointmentId ?? null,
      patientKey: input.patientKey,
      patientName: emptyToNull(input.patientName),
      summary: input.summary,
      treatmentPerformed: emptyToNull(input.treatmentPerformed),
      observations: emptyToNull(input.observations),
      nextSteps: emptyToNull(input.nextSteps),
      private: input.private ?? false,
      authorUserId: ctx.userId,
    })
    .returning();
  return row;
}
