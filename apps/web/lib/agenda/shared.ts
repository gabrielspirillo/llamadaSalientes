// Tipos y etiquetas del módulo Agenda que se comparten entre servidor y
// cliente. Sin `server-only` a propósito: los componentes del calendario los
// necesitan para pintar, y el motor de disponibilidad para calcular.

/** ISO: 1 = lunes … 7 = domingo. Misma convención que `lib/tasks/tz.ts`. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
};

export const WEEKDAY_SHORT: Record<number, string> = {
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
  7: 'Dom',
};

export type AppointmentStatus =
  | 'SCHEDULED'
  | 'CONFIRMED'
  | 'ARRIVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export type AppointmentSource = 'PANEL' | 'VOICE_AGENT' | 'WHATSAPP_AGENT' | 'WAITLIST' | 'IMPORT';

export type BlockKind = 'TIME_OFF' | 'HOLIDAY' | 'BREAK' | 'OTHER';

export type PanelAccess = 'AGENDA_ONLY' | 'FULL';

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Agendada',
  CONFIRMED: 'Confirmada',
  ARRIVED: 'En sala',
  IN_PROGRESS: 'En gabinete',
  COMPLETED: 'Atendida',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No se presentó',
};

export const SOURCE_LABELS: Record<AppointmentSource, string> = {
  PANEL: 'Panel',
  VOICE_AGENT: 'Agente de voz',
  WHATSAPP_AGENT: 'Agente de WhatsApp',
  WAITLIST: 'Lista de espera',
  IMPORT: 'Importada',
};

export const BLOCK_KIND_LABELS: Record<BlockKind, string> = {
  TIME_OFF: 'Ausencia',
  HOLIDAY: 'Festivo',
  BREAK: 'Descanso',
  OTHER: 'Otro',
};

/** Estados que ocupan el hueco. Una cancelada o un no-show liberan la agenda. */
export const BUSY_STATUSES: AppointmentStatus[] = [
  'SCHEDULED',
  'CONFIRMED',
  'ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
];

/**
 * Paleta con la que se distinguen los profesionales en la vista de todos.
 * Son los acentos del sistema Aurora, no colores nuevos.
 */
export const PROFESSIONAL_COLORS = [
  '#37766a',
  '#2f6f9f',
  '#a8557f',
  '#b8792a',
  '#7b5ea7',
  '#478f5c',
  '#c05b4d',
  '#3f7f8c',
] as const;

/** Minutos desde medianoche → 'HH:MM'. */
export function minutesToHHMM(minutes: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 'HH:MM' → minutos desde medianoche. Devuelve null si no parsea. */
export function hhmmToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 24 || minute > 59) return null;
  const total = hour * 60 + minute;
  return total > 1440 ? null : total;
}

export interface ShiftRule {
  weekday: number;
  startMinute: number;
  endMinute: number;
  /** 'YYYY-MM-DD' o null. Vigencia opcional de la franja. */
  validFrom?: string | null;
  validUntil?: string | null;
  active?: boolean;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface SlotCandidate {
  start: Date;
  end: Date;
}
