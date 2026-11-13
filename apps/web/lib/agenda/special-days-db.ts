import 'server-only';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import type { AgendaContext } from '@/lib/agenda/auth';
import { BUSY_STATUSES, type ShiftRule } from '@/lib/agenda/shared';
import {
  MAX_SPECIAL_DAYS_AHEAD,
  type MinuteRange,
  fitsInRanges,
  normalizeRanges,
  parseStoredRanges,
} from '@/lib/agenda/special-days';
import { db } from '@/lib/db/client';
import {
  agendaAppointments,
  clinicSettings,
  professionalSpecialDays,
  professionals,
} from '@/lib/db/schema';
import {
  addDaysToKey,
  localDateKey,
  localParts,
  parseDateKey,
  weekdayOfKey,
  zonedToUtc,
} from '@/lib/tasks/tz';

/**
 * Días con horario especial: lectura y escritura. Lo puro (validar franjas,
 * textos) está en `special-days.ts`. El motor de huecos los recibe como
 * franjas con `date` (`ShiftRule.date`), que sustituyen al horario semanal de
 * ese día (`shiftsForDate`).
 */

type Executor = Pick<typeof db, 'select'>;

async function clinicTimezone(tenantId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: clinicSettings.timezone })
    .from(clinicSettings)
    .where(eq(clinicSettings.tenantId, tenantId))
    .limit(1);
  return row?.timezone || 'Europe/Madrid';
}

export type SpecialDayRow = {
  id: string;
  professionalId: string;
  day: string;
  ranges: MinuteRange[];
  note: string | null;
};

/** Días especiales de una clínica (opcionalmente de unos profesionales y un rango). */
export async function listSpecialDays(
  tenantId: string,
  opts: { professionalIds?: string[]; fromKey?: string; toKey?: string } = {},
  exec: Executor = db,
): Promise<SpecialDayRow[]> {
  if (opts.professionalIds && opts.professionalIds.length === 0) return [];
  const rows = await exec
    .select({
      id: professionalSpecialDays.id,
      professionalId: professionalSpecialDays.professionalId,
      day: professionalSpecialDays.day,
      ranges: professionalSpecialDays.ranges,
      note: professionalSpecialDays.note,
    })
    .from(professionalSpecialDays)
    .where(
      and(
        eq(professionalSpecialDays.tenantId, tenantId),
        ...(opts.professionalIds
          ? [inArray(professionalSpecialDays.professionalId, opts.professionalIds)]
          : []),
        ...(opts.fromKey ? [gte(professionalSpecialDays.day, opts.fromKey)] : []),
        ...(opts.toKey ? [lte(professionalSpecialDays.day, opts.toKey)] : []),
      ),
    )
    .orderBy(asc(professionalSpecialDays.day));
  return rows
    .map((r) => ({ ...r, day: String(r.day), ranges: parseStoredRanges(r.ranges) }))
    .filter((r) => r.ranges.length > 0);
}

/** Los días especiales como franjas del motor (`ShiftRule` con `date`). */
export function specialDaysToRules(rows: SpecialDayRow[]): ShiftRule[] {
  return rows.flatMap((r) =>
    r.ranges.map((range) => ({
      weekday: weekdayOfKey(r.day),
      startMinute: range.start,
      endMinute: range.end,
      active: true,
      date: r.day,
    })),
  );
}

/**
 * Franjas especiales de UN profesional en un rango, listas para sumarse a las
 * semanales. Ante un error devuelve [] (se trabaja con el horario semanal):
 * un fallo aquí no puede dejar la agenda sin huecos.
 */
export async function specialRulesFor(
  tenantId: string,
  professionalId: string,
  fromKey: string,
  toKey: string,
  exec: Executor = db,
): Promise<ShiftRule[]> {
  try {
    return specialDaysToRules(
      await listSpecialDays(tenantId, { professionalIds: [professionalId], fromKey, toKey }, exec),
    );
  } catch (err) {
    console.warn('[dias-especiales] no se pudieron leer', (err as Error).message);
    return [];
  }
}

export class SpecialDayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecialDayError';
  }
}

/**
 * Crea o reemplaza el horario especial de un profesional un día. Devuelve
 * cuántas citas que ya había ese día quedan FUERA del nuevo horario: no se
 * tocan (igual que un bloqueo), se avisa para que la clínica decida.
 */
export async function upsertSpecialDay(
  ctx: AgendaContext,
  input: { professionalId: string; day: string; ranges: MinuteRange[]; note?: string | null },
): Promise<{ id: string; outside: number }> {
  if (!ctx.canManageProfessionals) {
    throw new SpecialDayError('Sólo un administrador de la clínica puede cambiar el horario.');
  }
  const parsedDay = parseDateKey(input.day);
  if (!parsedDay) throw new SpecialDayError('La fecha no es válida.');
  const tz = await clinicTimezone(ctx.tenantId);
  const todayKey = localDateKey(new Date(), tz);
  if (input.day < todayKey)
    throw new SpecialDayError('No se puede poner un horario a un día pasado.');
  if (input.day > addDaysToKey(todayKey, MAX_SPECIAL_DAYS_AHEAD)) {
    throw new SpecialDayError('Como mucho con un año de antelación.');
  }
  const norm = normalizeRanges(input.ranges);
  if (!norm.ok) throw new SpecialDayError(norm.error);

  const [prof] = await db
    .select({ id: professionals.id })
    .from(professionals)
    .where(
      and(eq(professionals.tenantId, ctx.tenantId), eq(professionals.id, input.professionalId)),
    )
    .limit(1);
  if (!prof) throw new SpecialDayError('Ese profesional no es de esta clínica.');

  const note = input.note?.trim().slice(0, 200) || null;
  const [row] = await db
    .insert(professionalSpecialDays)
    .values({
      tenantId: ctx.tenantId,
      professionalId: input.professionalId,
      day: input.day,
      ranges: norm.ranges,
      note,
      createdBy: ctx.clerkUserId,
    })
    .onConflictDoUpdate({
      target: [
        professionalSpecialDays.tenantId,
        professionalSpecialDays.professionalId,
        professionalSpecialDays.day,
      ],
      set: { ranges: norm.ranges, note, updatedAt: new Date() },
    })
    .returning({ id: professionalSpecialDays.id });

  const outside = await appointmentsOutside(
    ctx.tenantId,
    input.professionalId,
    input.day,
    norm.ranges,
    tz,
  );
  return { id: row?.id ?? '', outside };
}

/** Quita un día especial: ese día vuelve el horario de siempre. */
export async function deleteSpecialDay(ctx: AgendaContext, id: string): Promise<void> {
  if (!ctx.canManageProfessionals) {
    throw new SpecialDayError('Sólo un administrador de la clínica puede cambiar el horario.');
  }
  await db
    .delete(professionalSpecialDays)
    .where(
      and(eq(professionalSpecialDays.tenantId, ctx.tenantId), eq(professionalSpecialDays.id, id)),
    );
}

/** Citas vivas de ese día que no caben en las franjas nuevas. */
export async function appointmentsOutside(
  tenantId: string,
  professionalId: string,
  day: string,
  ranges: MinuteRange[],
  tz: string,
): Promise<number> {
  const p = parseDateKey(day);
  if (!p) return 0;
  const from = zonedToUtc(p.year, p.month, p.day, 0, 0, tz);
  const to = new Date(from.getTime() + 36 * 3_600_000);
  const rows = await db
    .select({ startsAt: agendaAppointments.startsAt, endsAt: agendaAppointments.endsAt })
    .from(agendaAppointments)
    .where(
      and(
        eq(agendaAppointments.tenantId, tenantId),
        eq(agendaAppointments.professionalId, professionalId),
        inArray(agendaAppointments.status, BUSY_STATUSES),
        gte(agendaAppointments.startsAt, from),
        sql`${agendaAppointments.startsAt} < ${to.toISOString()}::timestamptz`,
      ),
    );
  return rows.filter((a) => {
    if (localDateKey(a.startsAt, tz) !== day) return false;
    const s = localParts(a.startsAt, tz);
    const start = s.hour * 60 + s.minute;
    const end = start + Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000);
    return !fitsInRanges(start, end, ranges);
  }).length;
}

/**
 * Franjas especiales de toda la clínica en un rango, por profesional y día.
 * Ante un error, mapa vacío: se trabaja con el horario semanal.
 */
export async function loadSpecialRangesMap(
  tenantId: string,
  fromKey: string,
  toKey: string,
): Promise<Map<string, MinuteRange[]>> {
  const map = new Map<string, MinuteRange[]>();
  try {
    for (const r of await listSpecialDays(tenantId, { fromKey, toKey })) {
      map.set(`${r.professionalId}|${r.day}`, r.ranges);
    }
  } catch (err) {
    console.warn('[dias-especiales] no se pudieron leer', (err as Error).message);
  }
  return map;
}

/**
 * ¿Se puede ofrecer este hueco según el horario de la clínica? Un día con
 * horario especial manda el horario especial (la clínica lo abrió a propósito,
 * aunque su horario semanal diga que abre por la tarde o que cierra ese día);
 * el resto de días, el horario de atención de siempre.
 */
export function openForAgents(
  slot: { start: Date; end: Date; professionalId: string },
  timezone: string,
  special: Map<string, MinuteRange[]>,
  isWithinClinicHours: (start: Date, end: Date) => boolean,
): boolean {
  const day = localDateKey(slot.start, timezone);
  const ranges = special.get(`${slot.professionalId}|${day}`);
  if (ranges?.length) {
    const p = localParts(slot.start, timezone);
    const start = p.hour * 60 + p.minute;
    const end = start + Math.round((slot.end.getTime() - slot.start.getTime()) / 60_000);
    return fitsInRanges(start, end, ranges);
  }
  return isWithinClinicHours(slot.start, slot.end);
}

/**
 * El párrafo de días especiales para los asistentes (los próximos 60 días),
 * con el nombre del profesional si hay más de uno. '' si no hay ninguno o si
 * falla la lectura: el prompt queda como siempre.
 */
export async function specialDaysPromptText(
  tenantId: string,
  timezone: string,
): Promise<{
  text: string;
  days: string[];
}> {
  try {
    const todayKey = localDateKey(new Date(), timezone);
    const rows = await listSpecialDays(tenantId, {
      fromKey: todayKey,
      toKey: addDaysToKey(todayKey, 60),
    });
    if (rows.length === 0) return { text: '', days: [] };
    const names = await db
      .select({ id: professionals.id, fullName: professionals.fullName })
      .from(professionals)
      .where(
        and(
          eq(professionals.tenantId, tenantId),
          inArray(professionals.id, [...new Set(rows.map((r) => r.professionalId))]),
        ),
      );
    const nameOf = new Map(names.map((n) => [n.id, n.fullName]));
    const { specialDaysText } = await import('@/lib/agenda/special-days');
    return {
      text: specialDaysText(
        rows.map((r) => ({
          day: r.day,
          ranges: r.ranges,
          professionalName: nameOf.get(r.professionalId) ?? null,
        })),
        todayKey,
      ),
      days: [...new Set(rows.map((r) => r.day))],
    };
  } catch (err) {
    console.warn('[dias-especiales] texto del prompt', (err as Error).message);
    return { text: '', days: [] };
  }
}
