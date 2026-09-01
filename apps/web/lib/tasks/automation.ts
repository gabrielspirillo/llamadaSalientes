import 'server-only';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { taskAutomationRules } from '@/lib/db/schema';
import type { TaskAutomationTrigger, TaskCategory, TaskPriority } from '@/lib/tasks/constants';
import { TASK_AUTOMATION_TRIGGERS } from '@/lib/tasks/constants';
import { createTask } from '@/lib/tasks/service';

/**
 * Reglas de automatización: el puente entre lo que la app ya sabe y lo que
 * alguien tiene que hacer.
 *
 * La premisa del módulo: si hay que acordarse de crear la tarea, la tarea no
 * se crea. Todo lo que sigue nace de un evento que el producto ya emite
 * (webhook de Retell, webhook de GHL, recordatorio sin respuesta, waitlist).
 */
export interface AutomationRuleDefaults {
  trigger: TaskAutomationTrigger;
  titleTemplate: string;
  descriptionTemplate: string;
  category: TaskCategory;
  priority: TaskPriority;
  dueOffsetMinutes: number;
  requiresEvidence: boolean;
  enabled: boolean;
  params: Record<string, unknown>;
}

export const AUTOMATION_DEFAULTS: AutomationRuleDefaults[] = [
  {
    trigger: 'MISSED_CALL',
    titleTemplate: 'Devolver llamada a {{patientName}}',
    descriptionTemplate:
      'Entró una llamada que el agente no pudo resolver. Teléfono: {{phone}}. Devolvela antes de que llame a otra clínica.',
    category: 'PATIENT',
    priority: 'URGENT',
    dueOffsetMinutes: 120,
    requiresEvidence: false,
    enabled: true,
    params: {},
  },
  {
    trigger: 'CALL_INTENT_UNRESOLVED',
    titleTemplate: 'Cerrar la cita de {{patientName}}',
    descriptionTemplate:
      'Llamó para pedir cita y colgó sin reservarla. Es el contacto más receptivo que hay: {{phone}}.',
    category: 'PATIENT',
    priority: 'URGENT',
    dueOffsetMinutes: 180,
    requiresEvidence: false,
    enabled: true,
    params: {},
  },
  {
    trigger: 'APPOINTMENT_CANCELLED',
    titleTemplate: 'Dar nueva cita a {{patientName}}',
    descriptionTemplate:
      'Canceló la cita del {{date}}. Llámale hoy: cuanto más tiempo pasa, menos probable es que vuelva. Teléfono: {{phone}}.',
    category: 'PATIENT',
    priority: 'HIGH',
    dueOffsetMinutes: 480,
    requiresEvidence: false,
    enabled: true,
    params: {},
  },
  {
    trigger: 'APPOINTMENT_NO_SHOW',
    titleTemplate: 'No se presentó: {{patientName}}',
    descriptionTemplate:
      'No acudió a la cita del {{date}}. Contacta con él, anota el motivo y aplica la política de faltas. Teléfono: {{phone}}.',
    category: 'PATIENT',
    priority: 'HIGH',
    dueOffsetMinutes: 240,
    requiresEvidence: true,
    enabled: true,
    params: {},
  },
  {
    trigger: 'REMINDER_NO_RESPONSE',
    titleTemplate: 'Confirmar por teléfono a {{patientName}}',
    descriptionTemplate:
      'Se le mandó el recordatorio de la cita del {{date}} y no respondió. Una llamada corta evita el hueco. Teléfono: {{phone}}.',
    category: 'PATIENT',
    priority: 'HIGH',
    dueOffsetMinutes: 120,
    requiresEvidence: false,
    enabled: true,
    params: {},
  },
  {
    trigger: 'POST_TREATMENT_FOLLOWUP',
    titleTemplate: 'Llamada postoperatoria a {{patientName}}',
    descriptionTemplate:
      'Tratamiento: {{treatment}} el {{date}}. Pregunta por dolor, inflamación y medicación. Teléfono: {{phone}}.',
    category: 'PATIENT',
    priority: 'MEDIUM',
    dueOffsetMinutes: 1440,
    requiresEvidence: true,
    enabled: true,
    params: { followUpHours: 24 },
  },
  {
    trigger: 'PENDING_TREATMENT_UNSCHEDULED',
    titleTemplate: 'Perseguir presupuesto de {{patientName}}',
    descriptionTemplate:
      'Tiene pendiente: {{treatment}}. No tiene ninguna cita futura. Llama, resuelve lo que le frena y dale cita. Teléfono: {{phone}}.',
    category: 'PATIENT',
    priority: 'HIGH',
    dueOffsetMinutes: 2880,
    requiresEvidence: false,
    enabled: true,
    params: {},
  },
  {
    trigger: 'PATIENT_INACTIVE',
    titleTemplate: 'Reactivar a {{patientName}}',
    descriptionTemplate:
      'Última visita: {{date}}. Ofrecé revisión e higiene. Reactivar cuesta una fracción de captar. Teléfono: {{phone}}.',
    category: 'MARKETING',
    priority: 'MEDIUM',
    dueOffsetMinutes: 4320,
    requiresEvidence: false,
    enabled: true,
    params: { inactiveMonths: 12 },
  },
  {
    trigger: 'WHATSAPP_HANDOFF',
    titleTemplate: 'Responder el WhatsApp de {{patientName}}',
    descriptionTemplate:
      'La conversación quedó escalada a una persona. Entrá al inbox y cerrala. Teléfono: {{phone}}.',
    category: 'PATIENT',
    priority: 'URGENT',
    dueOffsetMinutes: 60,
    requiresEvidence: false,
    enabled: true,
    params: {},
  },
  {
    trigger: 'WAITLIST_ACCEPTED_UNSCHEDULED',
    titleTemplate: 'Agendar el hueco que aceptó {{patientName}}',
    descriptionTemplate:
      'Aceptó adelantar su cita al {{date}} y la cita no llegó a crearse. Ya dijo que sí: solo falta cerrarlo. Teléfono: {{phone}}.',
    category: 'PATIENT',
    priority: 'URGENT',
    dueOffsetMinutes: 60,
    requiresEvidence: false,
    enabled: true,
    params: {},
  },
];

/** Crea las reglas que falten para el tenant. Idempotente. */
export async function ensureAutomationRules(tenantId: string): Promise<void> {
  const existing = await db
    .select({ trigger: taskAutomationRules.trigger })
    .from(taskAutomationRules)
    .where(eq(taskAutomationRules.tenantId, tenantId));
  const have = new Set(existing.map((r) => r.trigger));
  const missing = AUTOMATION_DEFAULTS.filter((d) => !have.has(d.trigger));
  if (missing.length === 0) return;

  await db
    .insert(taskAutomationRules)
    .values(
      missing.map((d) => ({
        tenantId,
        trigger: d.trigger,
        enabled: d.enabled,
        titleTemplate: d.titleTemplate,
        descriptionTemplate: d.descriptionTemplate,
        category: d.category,
        priority: d.priority,
        dueOffsetMinutes: d.dueOffsetMinutes,
        requiresEvidence: d.requiresEvidence,
        params: d.params,
      })),
    )
    .onConflictDoNothing();
}

export interface AutomationContext {
  patientName?: string | null;
  phone?: string | null;
  /** Ya formateada para leer, no ISO. */
  date?: string | null;
  treatment?: string | null;
  patientGhlContactId?: string | null;
  callId?: string | null;
  whatsappConversationId?: string | null;
  ghlAppointmentId?: string | null;
  reminderId?: string | null;
  waitlistEntryId?: string | null;
  /** Sufijo de la clave de dedupe. Sin esto la regla puede duplicar. */
  dedupeSuffix: string;
}

export function renderTemplate(tpl: string, ctx: AutomationContext): string {
  return tpl
    .replace(/\{\{patientName\}\}/g, ctx.patientName?.trim() || 'un paciente')
    .replace(/\{\{phone\}\}/g, ctx.phone?.trim() || 'sin teléfono')
    .replace(/\{\{date\}\}/g, ctx.date?.trim() || 'fecha sin registrar')
    .replace(/\{\{treatment\}\}/g, ctx.treatment?.trim() || 'tratamiento sin especificar');
}

export type AutomationResult =
  | { created: true; taskId: string }
  | { created: false; reason: 'no_rule' | 'disabled' | 'duplicate' | 'error' };

/**
 * Dispara una regla. Silencioso y best-effort a propósito: ningún webhook ni
 * job debe fallar porque no se pudo crear una tarea.
 */
export async function runTaskAutomation(args: {
  tenantId: string;
  trigger: TaskAutomationTrigger;
  context: AutomationContext;
}): Promise<AutomationResult> {
  try {
    const [rule] = await db
      .select()
      .from(taskAutomationRules)
      .where(
        and(
          eq(taskAutomationRules.tenantId, args.tenantId),
          eq(taskAutomationRules.trigger, args.trigger),
        ),
      )
      .limit(1);

    if (!rule) return { created: false, reason: 'no_rule' };
    if (!rule.enabled) return { created: false, reason: 'disabled' };

    const dueAt = new Date(Date.now() + rule.dueOffsetMinutes * 60_000);
    const res = await createTask({
      tenantId: args.tenantId,
      title: renderTemplate(rule.titleTemplate, args.context),
      description: rule.descriptionTemplate
        ? renderTemplate(rule.descriptionTemplate, args.context)
        : null,
      category: rule.category,
      priority: rule.priority,
      dueAt,
      source: 'AUTOMATION',
      automationTrigger: args.trigger,
      dedupeKey: `auto:${args.trigger}:${args.context.dedupeSuffix}`,
      requiresEvidence: rule.requiresEvidence,
      assigneeUserIds: rule.assigneeUserId ? [rule.assigneeUserId] : [],
      patientGhlContactId: args.context.patientGhlContactId ?? null,
      patientName: args.context.patientName ?? null,
      patientPhone: args.context.phone ?? null,
      callId: args.context.callId ?? null,
      whatsappConversationId: args.context.whatsappConversationId ?? null,
      ghlAppointmentId: args.context.ghlAppointmentId ?? null,
      reminderId: args.context.reminderId ?? null,
      waitlistEntryId: args.context.waitlistEntryId ?? null,
      activityNote: `Creada por la automatización "${args.trigger}"`,
    });

    if (!res.created || !res.id) return { created: false, reason: 'duplicate' };
    return { created: true, taskId: res.id };
  } catch (err) {
    console.error('[tasks] automation failed', {
      trigger: args.trigger,
      tenantId: args.tenantId,
      err: (err as Error).message,
    });
    return { created: false, reason: 'error' };
  }
}

export function isAutomationTrigger(v: unknown): v is TaskAutomationTrigger {
  return typeof v === 'string' && (TASK_AUTOMATION_TRIGGERS as readonly string[]).includes(v);
}
