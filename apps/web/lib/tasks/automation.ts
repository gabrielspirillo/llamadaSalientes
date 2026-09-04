import 'server-only';
import { and, asc, desc, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { taskAutomationRules } from '@/lib/db/schema';
import type {
  AutomationCondition,
  AutomationConditionField,
  TaskAutomationTrigger,
  TaskCategory,
  TaskPriority,
} from '@/lib/tasks/constants';
import { TASK_AUTOMATION_TRIGGERS, TRIGGER_META } from '@/lib/tasks/constants';
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
      'Entró una llamada que el agente no pudo resolver. Teléfono: {{phone}}. Devuélvela antes de que llame a otra clínica.',
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
      'Última visita: {{date}}. Ofrécele revisión e higiene. Teléfono: {{phone}}.',
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
      'La conversación ha pasado a una persona. Entra en el buzón de WhatsApp y ciérrala. Teléfono: {{phone}}.',
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

/** Siembra las reglas de sistema que falten para el tenant. Idempotente. */
export async function ensureAutomationRules(tenantId: string): Promise<void> {
  // Solo miramos las de sistema: un tenant puede tener reglas a medida sobre un
  // evento y aun así faltarle la del catálogo, y hay que sembrarla igual.
  const existing = await db
    .select({ trigger: taskAutomationRules.trigger })
    .from(taskAutomationRules)
    .where(and(eq(taskAutomationRules.tenantId, tenantId), eq(taskAutomationRules.isSystem, true)));
  const have = new Set(existing.map((r) => r.trigger));
  const missing = AUTOMATION_DEFAULTS.filter((d) => !have.has(d.trigger));
  if (missing.length === 0) return;

  await db
    .insert(taskAutomationRules)
    .values(
      missing.map((d) => ({
        tenantId,
        trigger: d.trigger,
        name: TRIGGER_META[d.trigger].label,
        isSystem: true,
        enabled: d.enabled,
        titleTemplate: d.titleTemplate,
        descriptionTemplate: d.descriptionTemplate,
        category: d.category,
        priority: d.priority,
        dueOffsetMinutes: d.dueOffsetMinutes,
        requiresEvidence: d.requiresEvidence,
        conditions: [],
        checklist: [],
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

/** Minúsculas + sin acentos, para comparar sin sorpresas con nombres. */
function fold(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();
}

/** Valor de un campo de condición sacado del contexto del evento. */
function conditionValue(field: AutomationConditionField, ctx: AutomationContext): string {
  const raw =
    field === 'patientName'
      ? ctx.patientName
      : field === 'phone'
        ? ctx.phone
        : field === 'treatment'
          ? ctx.treatment
          : ctx.date;
  return (raw ?? '').trim();
}

/**
 * Evalúa los filtros de una regla contra el evento. Sin filtros → dispara
 * siempre (el caso de las 10 de sistema). Todos los filtros deben cumplirse (Y).
 * Una condición mal formada no bloquea el disparo: se ignora.
 */
export function evaluateConditions(
  conditions: AutomationCondition[] | null | undefined,
  ctx: AutomationContext,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  for (const c of conditions) {
    const actual = conditionValue(c.field, ctx);
    const needle = (c.value ?? '').trim();
    switch (c.op) {
      case 'exists':
        if (actual.length === 0) return false;
        break;
      case 'not_exists':
        if (actual.length > 0) return false;
        break;
      case 'equals':
        if (fold(actual) !== fold(needle)) return false;
        break;
      case 'contains':
        if (!fold(actual).includes(fold(needle))) return false;
        break;
      case 'not_contains':
        if (fold(actual).includes(fold(needle))) return false;
        break;
      default:
        break; // operador desconocido: no bloquea
    }
  }
  return true;
}

export type AutomationResult =
  | { created: true; taskId: string }
  | { created: false; reason: 'no_rule' | 'disabled' | 'no_match' | 'duplicate' | 'error' };

/**
 * Dispara las reglas de un evento. Silencioso y best-effort a propósito:
 * ningún webhook ni job debe fallar porque no se pudo crear una tarea.
 *
 * Puede haber varias reglas sobre el mismo evento (una de sistema + las de a
 * medida). Se recorren todas las activas cuyas condiciones se cumplan y cada
 * una crea su tarea. El dedupe de la regla de sistema conserva el formato
 * histórico (`auto:<trigger>:<suffix>`); las de a medida meten su id para no
 * pisarse entre ellas.
 */
export async function runTaskAutomation(args: {
  tenantId: string;
  trigger: TaskAutomationTrigger;
  context: AutomationContext;
}): Promise<AutomationResult> {
  try {
    const rules = await db
      .select()
      .from(taskAutomationRules)
      .where(
        and(
          eq(taskAutomationRules.tenantId, args.tenantId),
          eq(taskAutomationRules.trigger, args.trigger),
        ),
      )
      // La de sistema primero, y estable por creación: el taskId que se
      // devuelve es determinista.
      .orderBy(desc(taskAutomationRules.isSystem), asc(taskAutomationRules.createdAt));

    if (rules.length === 0) return { created: false, reason: 'no_rule' };
    const active = rules.filter((r) => r.enabled);
    if (active.length === 0) return { created: false, reason: 'disabled' };

    let firstTaskId: string | null = null;
    let anyMatched = false;

    for (const rule of active) {
      if (!evaluateConditions(rule.conditions as AutomationCondition[] | null, args.context)) {
        continue;
      }
      anyMatched = true;
      const dedupeKey = rule.isSystem
        ? `auto:${args.trigger}:${args.context.dedupeSuffix}`
        : `auto:${args.trigger}:${rule.id}:${args.context.dedupeSuffix}`;

      const res = await createTask({
        tenantId: args.tenantId,
        title: renderTemplate(rule.titleTemplate, args.context),
        description: rule.descriptionTemplate
          ? renderTemplate(rule.descriptionTemplate, args.context)
          : null,
        category: rule.category,
        priority: rule.priority,
        dueAt: new Date(Date.now() + rule.dueOffsetMinutes * 60_000),
        source: 'AUTOMATION',
        automationTrigger: args.trigger,
        dedupeKey,
        requiresEvidence: rule.requiresEvidence,
        assigneeUserIds: rule.assigneeUserId ? [rule.assigneeUserId] : [],
        checklist: (rule.checklist ?? []).filter((c) => c.trim().length > 0),
        patientGhlContactId: args.context.patientGhlContactId ?? null,
        patientName: args.context.patientName ?? null,
        patientPhone: args.context.phone ?? null,
        callId: args.context.callId ?? null,
        whatsappConversationId: args.context.whatsappConversationId ?? null,
        ghlAppointmentId: args.context.ghlAppointmentId ?? null,
        reminderId: args.context.reminderId ?? null,
        waitlistEntryId: args.context.waitlistEntryId ?? null,
        activityNote: `Creada por la automatización "${rule.name ?? args.trigger}"`,
      });

      if (res.created && res.id && !firstTaskId) firstTaskId = res.id;
    }

    if (firstTaskId) return { created: true, taskId: firstTaskId };
    if (!anyMatched) return { created: false, reason: 'no_match' };
    return { created: false, reason: 'duplicate' };
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
