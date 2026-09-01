// Catálogo visual y semántico del módulo Tareas.
//
// Client-safe a propósito (sin 'server-only', sin imports de db): lo consumen
// tanto los server components que arman los datos como las cards del tablero.

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_CATEGORIES = [
  'PATIENT',
  'CLINICAL',
  'ADMIN',
  'COMPLIANCE',
  'TEAM',
  'MARKETING',
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const TASK_SOURCES = ['MANUAL', 'ROUTINE', 'AUTOMATION'] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export const TASK_RECURRENCE_FREQS = [
  'DAILY',
  'WEEKDAYS',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'YEARLY',
] as const;
export type TaskRecurrenceFreq = (typeof TASK_RECURRENCE_FREQS)[number];

export const TASK_AUTOMATION_TRIGGERS = [
  'MISSED_CALL',
  'CALL_INTENT_UNRESOLVED',
  'APPOINTMENT_CANCELLED',
  'APPOINTMENT_NO_SHOW',
  'REMINDER_NO_RESPONSE',
  'POST_TREATMENT_FOLLOWUP',
  'PENDING_TREATMENT_UNSCHEDULED',
  'PATIENT_INACTIVE',
  'WHATSAPP_HANDOFF',
  'WAITLIST_ACCEPTED_UNSCHEDULED',
] as const;
export type TaskAutomationTrigger = (typeof TASK_AUTOMATION_TRIGGERS)[number];

// ─── Columnas del tablero ────────────────────────────────────────────────────

export const STATUS_META: Record<
  TaskStatus,
  { label: string; hint: string; dot: string; accent: string }
> = {
  TODO: {
    label: 'Por hacer',
    hint: 'Entrada del día',
    dot: 'bg-zinc-400',
    accent: 'text-zinc-500',
  },
  IN_PROGRESS: {
    label: 'En curso',
    hint: 'Alguien ya lo está haciendo',
    dot: 'bg-amber-500',
    accent: 'text-amber-600',
  },
  IN_REVIEW: {
    label: 'En revisión',
    hint: 'Esperando verificación',
    dot: 'bg-violet-500',
    accent: 'text-violet-600',
  },
  DONE: {
    label: 'Hecho',
    hint: 'Cerrado con evidencia',
    dot: 'bg-emerald-500',
    accent: 'text-emerald-600',
  },
};

// ─── Categorías (color pastel de la card, como la referencia) ────────────────

export const CATEGORY_META: Record<
  TaskCategory,
  {
    label: string;
    /** Texto corto que explica qué entra en esta categoría. */
    hint: string;
    /** Fondo + borde de la card en el tablero. */
    card: string;
    /** Chip de la etiqueta dentro de la card. */
    chip: string;
    /** Relleno de la barra de progreso. */
    bar: string;
    /** Punto de color para listas densas. */
    dot: string;
  }
> = {
  PATIENT: {
    label: 'Paciente',
    hint: 'Reagendar, presupuestos, postoperatorio, recall',
    card: 'bg-sky-50/80 border-sky-100',
    chip: 'bg-white/70 text-sky-700 ring-sky-200',
    bar: 'bg-sky-400',
    dot: 'bg-sky-400',
  },
  CLINICAL: {
    label: 'Gabinete',
    hint: 'Esterilización, instrumental, equipos',
    card: 'bg-emerald-50/80 border-emerald-100',
    chip: 'bg-white/70 text-emerald-700 ring-emerald-200',
    bar: 'bg-emerald-400',
    dot: 'bg-emerald-400',
  },
  ADMIN: {
    label: 'Administración',
    hint: 'Caja, agenda, stock, proveedores',
    card: 'bg-amber-50/80 border-amber-100',
    chip: 'bg-white/70 text-amber-700 ring-amber-200',
    bar: 'bg-amber-400',
    dot: 'bg-amber-400',
  },
  COMPLIANCE: {
    label: 'Cumplimiento',
    hint: 'RGPD, protección radiológica, validaciones',
    card: 'bg-violet-50/80 border-violet-100',
    chip: 'bg-white/70 text-violet-700 ring-violet-200',
    bar: 'bg-violet-400',
    dot: 'bg-violet-400',
  },
  TEAM: {
    label: 'Equipo',
    hint: 'Turnos, formación, reuniones',
    card: 'bg-rose-50/80 border-rose-100',
    chip: 'bg-white/70 text-rose-700 ring-rose-200',
    bar: 'bg-rose-400',
    dot: 'bg-rose-400',
  },
  MARKETING: {
    label: 'Marketing',
    hint: 'Reseñas, campañas, reactivación',
    card: 'bg-orange-50/80 border-orange-100',
    chip: 'bg-white/70 text-orange-700 ring-orange-200',
    bar: 'bg-orange-400',
    dot: 'bg-orange-400',
  },
};

// ─── Prioridades ─────────────────────────────────────────────────────────────

export const PRIORITY_META: Record<
  TaskPriority,
  { label: string; short: string; chip: string; weight: number }
> = {
  URGENT: {
    label: 'Urgente',
    short: '!!!',
    chip: 'bg-red-50 text-red-700 ring-red-200',
    weight: 3,
  },
  HIGH: {
    label: 'Alta',
    short: '!!',
    chip: 'bg-orange-50 text-orange-700 ring-orange-200',
    weight: 2,
  },
  MEDIUM: { label: 'Media', short: '!', chip: 'bg-zinc-50 text-zinc-600 ring-zinc-200', weight: 1 },
  LOW: { label: 'Baja', short: '', chip: 'bg-zinc-50 text-zinc-500 ring-zinc-200', weight: 0 },
};

export const SOURCE_META: Record<TaskSource, { label: string; hint: string }> = {
  MANUAL: { label: 'Manual', hint: 'Creada por una persona' },
  ROUTINE: { label: 'Rutina', hint: 'Generada por una plantilla recurrente' },
  AUTOMATION: { label: 'Automática', hint: 'Generada por una regla a partir de un evento' },
};

export const RECURRENCE_META: Record<TaskRecurrenceFreq, { label: string }> = {
  DAILY: { label: 'Todos los días' },
  WEEKDAYS: { label: 'De lunes a viernes' },
  WEEKLY: { label: 'Semanal' },
  MONTHLY: { label: 'Mensual' },
  QUARTERLY: { label: 'Trimestral' },
  YEARLY: { label: 'Anual' },
};

export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
  7: 'Dom',
};

// ─── Automatizaciones: qué dispara cada regla, en criollo ────────────────────

export const TRIGGER_META: Record<
  TaskAutomationTrigger,
  { label: string; when: string; why: string }
> = {
  MISSED_CALL: {
    label: 'Llamada perdida',
    when: 'Entra una llamada que el agente no pudo resolver o quedó cortada',
    why: 'Cada llamada sin devolver es un paciente que llama a la clínica de al lado',
  },
  CALL_INTENT_UNRESOLVED: {
    label: 'Quería cita y no quedó agendada',
    when: 'La llamada tuvo intención de agendar pero no se creó ninguna cita',
    why: 'Es el lead más caliente que existe: ya levantó el teléfono',
  },
  APPOINTMENT_CANCELLED: {
    label: 'Cita cancelada',
    when: 'GHL avisa que una cita se canceló',
    why: 'Reagendar en caliente evita que el paciente se caiga del sistema',
  },
  APPOINTMENT_NO_SHOW: {
    label: 'No se presentó',
    when: 'La cita queda marcada como no-show',
    why: 'El sillón vacío ya se perdió; lo recuperable es la próxima cita',
  },
  REMINDER_NO_RESPONSE: {
    label: 'Recordatorio sin respuesta',
    when: 'El recordatorio se envió y el paciente no confirmó dentro de la ventana',
    why: 'Una llamada de 40 segundos convierte una duda en una confirmación',
  },
  POST_TREATMENT_FOLLOWUP: {
    label: 'Seguimiento postoperatorio',
    when: 'Se completa una cita de un tratamiento marcado para seguimiento',
    why: 'Menos urgencias, mejor percepción y más reseñas',
  },
  PENDING_TREATMENT_UNSCHEDULED: {
    label: 'Presupuesto aceptado sin agendar',
    when: 'Un paciente con tratamiento pendiente no tiene ninguna cita futura',
    why: 'El seguimiento sube la aceptación de presupuestos del 45-55% al 65-75%',
  },
  PATIENT_INACTIVE: {
    label: 'Paciente inactivo',
    when: 'Pasan N meses desde la última visita sin cita futura',
    why: 'Reactivar cuesta una fracción de lo que cuesta captar',
  },
  WHATSAPP_HANDOFF: {
    label: 'WhatsApp escalado a humano',
    when: 'Una conversación se marca urgente o el agente pasa el control',
    why: 'El chat abandonado a medias es la peor versión de la atención',
  },
  WAITLIST_ACCEPTED_UNSCHEDULED: {
    label: 'Hueco aceptado sin cerrar',
    when: 'Un paciente acepta un hueco de la waitlist y la cita no se creó',
    why: 'Ya dijo que sí: solo falta que alguien lo confirme',
  },
};

// ─── Helpers de presentación compartidos ─────────────────────────────────────

export type DueTone = 'none' | 'future' | 'soon' | 'today' | 'overdue';

/** Semáforo de vencimiento usado por cards, listas y contadores. */
export function dueTone(dueAt: Date | string | null, now: Date = new Date()): DueTone {
  if (!dueAt) return 'none';
  const d = typeof dueAt === 'string' ? new Date(dueAt) : dueAt;
  if (Number.isNaN(d.getTime())) return 'none';
  const diffMs = d.getTime() - now.getTime();
  if (diffMs < 0) return 'overdue';
  if (diffMs <= 4 * 3600_000) return 'soon';
  if (sameLocalDay(d, now)) return 'today';
  return 'future';
}

export function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export const DUE_TONE_CLASS: Record<DueTone, string> = {
  none: 'text-zinc-400',
  future: 'text-zinc-500',
  soon: 'text-amber-600',
  today: 'text-amber-600',
  overdue: 'text-red-600',
};

export function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === 'string' && (TASK_STATUSES as readonly string[]).includes(v);
}
export function isTaskCategory(v: unknown): v is TaskCategory {
  return typeof v === 'string' && (TASK_CATEGORIES as readonly string[]).includes(v);
}
export function isTaskPriority(v: unknown): v is TaskPriority {
  return typeof v === 'string' && (TASK_PRIORITIES as readonly string[]).includes(v);
}
