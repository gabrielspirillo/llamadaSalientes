import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { TaskForbiddenError } from '@/lib/tasks/auth';
import {
  AUTOMATION_CONDITION_FIELDS,
  AUTOMATION_CONDITION_OPS,
  TASK_AUTOMATION_TRIGGERS,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_RECURRENCE_FREQS,
  TASK_STATUSES,
} from '@/lib/tasks/constants';
import { TaskEvidenceRequiredError, TaskNotFoundError } from '@/lib/tasks/service';

/** Traduce los errores del módulo a códigos HTTP. Un solo lugar. */
export function taskErrorResponse(err: unknown): NextResponse {
  if (err instanceof TaskForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof TaskNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof TaskEvidenceRequiredError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  const message = (err as Error)?.message ?? 'Unauthorized';
  if (/Unauthenticated|No active organization/.test(message)) {
    return NextResponse.json({ error: message }, { status: 401 });
  }
  console.error('[tasks-api] error', err);
  return NextResponse.json({ error: 'Error interno' }, { status: 500 });
}

export function badRequest(issues: unknown): NextResponse {
  return NextResponse.json({ error: 'Datos inválidos', issues }, { status: 400 });
}

// ─── Schemas compartidos ─────────────────────────────────────────────────────

export const categorySchema = z.enum(TASK_CATEGORIES);
export const prioritySchema = z.enum(TASK_PRIORITIES);
export const statusSchema = z.enum(TASK_STATUSES);
export const recurrenceSchema = z.enum(TASK_RECURRENCE_FREQS);

/** ISO date-time o null. Devuelve Date para que el service no parsee strings. */
export const dueAtSchema = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .transform((v) => (v ? new Date(v) : null));

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(4000).nullable().optional(),
  category: categorySchema.optional(),
  priority: prioritySchema.optional(),
  status: statusSchema.optional(),
  dueAt: dueAtSchema.optional(),
  dueAllDay: z.boolean().optional(),
  requiresEvidence: z.boolean().optional(),
  labels: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  assigneeUserIds: z.array(z.string().uuid()).max(10).optional(),
  checklist: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
  patientGhlContactId: z.string().max(120).nullable().optional(),
  patientName: z.string().max(160).nullable().optional(),
  patientPhone: z.string().max(40).nullable().optional(),
  callId: z.string().uuid().nullable().optional(),
  whatsappConversationId: z.string().uuid().nullable().optional(),
  ghlAppointmentId: z.string().max(120).nullable().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(4000).nullable().optional(),
  category: categorySchema.optional(),
  priority: prioritySchema.optional(),
  status: statusSchema.optional(),
  dueAt: dueAtSchema.optional(),
  dueAllDay: z.boolean().optional(),
  labels: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  // `requiresEvidence` NO se acepta aquí a propósito: mandarlo en el mismo
  // PATCH que cierra la tarea desactivaba el candado de evidencia. Es una
  // propiedad de la rutina, no algo que se edite tarea a tarea.
  evidenceNote: z.string().max(2000).nullable().optional(),
  assigneeUserIds: z.array(z.string().uuid()).max(10).optional(),
});

export const reorderSchema = z.object({
  status: statusSchema,
  orderedIds: z.array(z.string().uuid()).max(400),
});

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2000).nullable().optional(),
  category: categorySchema.optional(),
  priority: prioritySchema.optional(),
  recurrenceFreq: recurrenceSchema.optional(),
  recurrenceInterval: z.number().int().min(1).max(52).optional(),
  recurrenceWeekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  recurrenceMonthDay: z.number().int().min(1).max(28).nullable().optional(),
  recurrenceMonth: z.number().int().min(1).max(12).nullable().optional(),
  dueTime: z
    .string()
    .regex(/^\d{1,2}:\d{2}$/, 'Formato HH:MM')
    .optional(),
  leadDays: z.number().int().min(0).max(60).optional(),
  defaultRole: z.string().max(60).nullable().optional(),
  defaultAssigneeUserId: z.string().uuid().nullable().optional(),
  requiresEvidence: z.boolean().optional(),
  enabled: z.boolean().optional(),
  items: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
});

/** Una condición: `exists`/`not_exists` no llevan valor; el resto sí. */
export const conditionSchema = z
  .object({
    field: z.enum(AUTOMATION_CONDITION_FIELDS),
    op: z.enum(AUTOMATION_CONDITION_OPS),
    value: z.string().trim().max(120).optional(),
  })
  .refine((c) => c.op === 'exists' || c.op === 'not_exists' || (c.value?.length ?? 0) > 0, {
    message: 'La condición necesita un valor',
  });

export const conditionsSchema = z.array(conditionSchema).max(10);
export const checklistSchema = z.array(z.string().trim().min(1).max(300)).max(50);

/** PATCH de una regla (de sistema o a medida). No admite cambiar el evento. */
export const automationSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  titleTemplate: z.string().trim().min(1).max(300).optional(),
  descriptionTemplate: z.string().max(2000).nullable().optional(),
  category: categorySchema.optional(),
  priority: prioritySchema.optional(),
  dueOffsetMinutes: z.number().int().min(5).max(20160).optional(),
  assigneeUserId: z.string().uuid().nullable().optional(),
  assigneeRole: z.string().max(60).nullable().optional(),
  requiresEvidence: z.boolean().optional(),
  conditions: conditionsSchema.optional(),
  checklist: checklistSchema.optional(),
  params: z.record(z.unknown()).optional(),
});

/** POST: alta de una automatización a medida. El evento es obligatorio. */
export const automationCreateSchema = z.object({
  trigger: z.enum(TASK_AUTOMATION_TRIGGERS),
  name: z.string().trim().min(1).max(120),
  titleTemplate: z.string().trim().min(1).max(300),
  descriptionTemplate: z.string().max(2000).nullable().optional(),
  category: categorySchema.optional(),
  priority: prioritySchema.optional(),
  dueOffsetMinutes: z.number().int().min(5).max(20160).optional(),
  assigneeUserId: z.string().uuid().nullable().optional(),
  requiresEvidence: z.boolean().optional(),
  conditions: conditionsSchema.optional(),
  checklist: checklistSchema.optional(),
});
