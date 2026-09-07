// Modelo de vista del calendario.
//
// El servidor le da al cliente las citas YA situadas en el día y el minuto
// local de la clínica. Si la conversión la hiciera el navegador, una clínica de
// Madrid vista desde un portátil en otra zona pintaría la agenda corrida: el
// calendario dibujaría "las 9" del navegador, no las 9 de la clínica.

import type { AppointmentSource, AppointmentStatus, BlockKind } from '@/lib/agenda/shared';
import { localDateKey, localParts } from '@/lib/tasks/tz';

export interface CalendarItem {
  id: string;
  professionalId: string;
  professionalName: string;
  color: string;
  patientName: string;
  patientKey: string;
  patientPhone: string | null;
  treatmentId: string | null;
  treatmentName: string | null;
  status: AppointmentStatus;
  source: AppointmentSource;
  notes: string | null;
  /** Día local al que pertenece el trozo pintado. */
  dateKey: string;
  /** Minutos desde medianoche local, ya recortados al día. */
  startMinute: number;
  endMinute: number;
  /** Instantes reales, para reagendar sin recalcular nada. */
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  /** true si la cita se sale del día (empezó ayer o termina mañana). */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface CalendarBlock {
  id: string;
  professionalId: string;
  kind: BlockKind;
  reason: string | null;
  dateKey: string;
  startMinute: number;
  endMinute: number;
  allDay: boolean;
}

interface SourceAppointment {
  id: string;
  professionalId: string;
  professionalName: string;
  professionalColor: string;
  patientName: string;
  patientKey: string;
  patientPhone: string | null;
  treatmentId: string | null;
  treatmentName: string | null;
  status: AppointmentStatus;
  source: AppointmentSource;
  notes: string | null;
  startsAt: Date;
  endsAt: Date;
}

/** Minutos desde medianoche local de un instante. */
export function minuteOfDay(date: Date, timezone: string): number {
  const p = localParts(date, timezone);
  return p.hour * 60 + p.minute;
}

/**
 * Recorta una cita a los días que se piden. Una cita normal cae entera en un
 * día; el recorte existe porque una intervención larga a última hora puede
 * cruzar la medianoche y, sin esto, desaparecería del calendario.
 */
export function toCalendarItems(
  appointments: SourceAppointment[],
  dateKeys: string[],
  timezone: string,
): CalendarItem[] {
  const wanted = new Set(dateKeys);
  const out: CalendarItem[] = [];

  for (const a of appointments) {
    const startKey = localDateKey(a.startsAt, timezone);
    const endKey = localDateKey(new Date(a.endsAt.getTime() - 1), timezone);
    const duration = Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000);

    for (const dateKey of dateKeys) {
      if (dateKey < startKey || dateKey > endKey) continue;
      if (!wanted.has(dateKey)) continue;

      const startMinute = dateKey === startKey ? minuteOfDay(a.startsAt, timezone) : 0;
      const rawEnd = dateKey === endKey ? minuteOfDay(a.endsAt, timezone) : 1440;
      // Una cita que termina justo a medianoche da minuto 0: es el final del
      // día anterior, no un bloque de duración cero.
      const endMinute = rawEnd === 0 ? 1440 : rawEnd;

      out.push({
        id: a.id,
        professionalId: a.professionalId,
        professionalName: a.professionalName,
        color: a.professionalColor,
        patientName: a.patientName,
        patientKey: a.patientKey,
        patientPhone: a.patientPhone,
        treatmentId: a.treatmentId,
        treatmentName: a.treatmentName,
        status: a.status,
        source: a.source,
        notes: a.notes,
        dateKey,
        startMinute,
        endMinute: Math.max(endMinute, startMinute + 5),
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
        durationMinutes: duration,
        continuesBefore: dateKey !== startKey,
        continuesAfter: dateKey !== endKey,
      });
    }
  }

  return out.sort((a, b) => a.startMinute - b.startMinute);
}

export function toCalendarBlocks(
  blocks: {
    id: string;
    professionalId: string;
    kind: BlockKind;
    reason: string | null;
    allDay: boolean;
    startsAt: Date;
    endsAt: Date;
  }[],
  dateKeys: string[],
  timezone: string,
): CalendarBlock[] {
  const out: CalendarBlock[] = [];
  for (const b of blocks) {
    const startKey = localDateKey(b.startsAt, timezone);
    const endKey = localDateKey(new Date(b.endsAt.getTime() - 1), timezone);
    for (const dateKey of dateKeys) {
      if (dateKey < startKey || dateKey > endKey) continue;
      const startMinute = dateKey === startKey ? minuteOfDay(b.startsAt, timezone) : 0;
      const rawEnd = dateKey === endKey ? minuteOfDay(b.endsAt, timezone) : 1440;
      const endMinute = rawEnd === 0 ? 1440 : rawEnd;
      out.push({
        id: b.id,
        professionalId: b.professionalId,
        kind: b.kind,
        reason: b.reason,
        dateKey,
        startMinute,
        endMinute: Math.max(endMinute, startMinute + 5),
        allDay: b.allDay || (startMinute === 0 && endMinute >= 1440),
      });
    }
  }
  return out;
}

/**
 * Ventana horaria que pinta el calendario. Se ajusta a lo que hay: si nadie
 * trabaja antes de las 9 no tiene sentido dibujar la madrugada, y si hay una
 * urgencia a las 22:00 tiene que verse.
 */
export function computeDayWindow(
  shifts: { startMinute: number; endMinute: number }[],
  items: { startMinute: number; endMinute: number }[],
): { startMinute: number; endMinute: number } {
  let start = 8 * 60;
  let end = 20 * 60;

  const mins = [...shifts.map((s) => s.startMinute), ...items.map((i) => i.startMinute)];
  const maxs = [...shifts.map((s) => s.endMinute), ...items.map((i) => i.endMinute)];

  if (mins.length > 0) start = Math.min(start, Math.min(...mins));
  if (maxs.length > 0) end = Math.max(end, Math.max(...maxs));

  // Se redondea a la hora para que la rejilla tenga líneas enteras.
  start = Math.max(0, Math.floor(start / 60) * 60);
  end = Math.min(1440, Math.ceil(end / 60) * 60);
  if (end <= start) end = Math.min(1440, start + 60);
  return { startMinute: start, endMinute: end };
}

/** Los N días de la semana ISO que contiene `dateKey` (lunes primero). */
export function weekDateKeys(dateKey: string): string[] {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return [dateKey];
  const base = new Date(Date.UTC(y, m - 1, d));
  const iso = base.getUTCDay() === 0 ? 7 : base.getUTCDay();
  const monday = new Date(base.getTime() - (iso - 1) * 86_400_000);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday.getTime() + i * 86_400_000);
    return `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(
      day.getUTCDate(),
    ).padStart(2, '0')}`;
  });
}

/** 'Lunes 8 de septiembre' — cabeceras del calendario. */
export function formatDateKeyLong(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return dateKey;
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatDateKeyShort(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return dateKey;
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
