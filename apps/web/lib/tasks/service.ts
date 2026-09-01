import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { taskAssignees, taskChecklistItems, taskComments, tasks } from '@/lib/db/schema';
import type {
  TaskAutomationTrigger,
  TaskCategory,
  TaskPriority,
  TaskSource,
  TaskStatus,
} from '@/lib/tasks/constants';

export class TaskEvidenceRequiredError extends Error {
  constructor() {
    super('Esta tarea exige una nota de evidencia para poder cerrarse');
    this.name = 'TaskEvidenceRequiredError';
  }
}

export class TaskNotFoundError extends Error {
  constructor() {
    super('La tarea no existe o no pertenece a esta clínica');
    this.name = 'TaskNotFoundError';
  }
}

export interface CreateTaskInput {
  tenantId: string;
  title: string;
  description?: string | null;
  category?: TaskCategory;
  priority?: TaskPriority;
  status?: TaskStatus;
  dueAt?: Date | null;
  dueAllDay?: boolean;
  source?: TaskSource;
  templateId?: string | null;
  automationTrigger?: TaskAutomationTrigger | null;
  /** Clave de idempotencia por tenant. Si ya existe, no se crea nada. */
  dedupeKey?: string | null;
  requiresEvidence?: boolean;
  labels?: string[];
  assigneeUserIds?: string[];
  checklist?: string[];
  createdByUserId?: string | null;
  patientGhlContactId?: string | null;
  patientName?: string | null;
  patientPhone?: string | null;
  callId?: string | null;
  whatsappConversationId?: string | null;
  ghlAppointmentId?: string | null;
  reminderId?: string | null;
  waitlistEntryId?: string | null;
  /** Texto de la primera entrada del timeline. */
  activityNote?: string | null;
}

/**
 * Alta de tarea. Devuelve `created: false` cuando el `dedupeKey` ya existía —
 * es lo que permite a las automatizaciones y al worker de rutinas reintentar
 * sin ensuciar el tablero con duplicados.
 */
export async function createTask(
  input: CreateTaskInput,
): Promise<{ id: string | null; created: boolean }> {
  const status = input.status ?? 'TODO';
  const position = await nextBoardPosition(input.tenantId, status);

  const [row] = await db
    .insert(tasks)
    .values({
      tenantId: input.tenantId,
      title: input.title.trim().slice(0, 300),
      description: input.description ?? null,
      category: input.category ?? 'ADMIN',
      priority: input.priority ?? 'MEDIUM',
      status,
      boardPosition: position,
      dueAt: input.dueAt ?? null,
      dueAllDay: input.dueAllDay ?? false,
      source: input.source ?? 'MANUAL',
      templateId: input.templateId ?? null,
      automationTrigger: input.automationTrigger ?? null,
      dedupeKey: input.dedupeKey ?? null,
      requiresEvidence: input.requiresEvidence ?? false,
      labels: input.labels ?? [],
      createdByUserId: input.createdByUserId ?? null,
      patientGhlContactId: input.patientGhlContactId ?? null,
      patientName: input.patientName ?? null,
      patientPhone: input.patientPhone ?? null,
      callId: input.callId ?? null,
      whatsappConversationId: input.whatsappConversationId ?? null,
      ghlAppointmentId: input.ghlAppointmentId ?? null,
      reminderId: input.reminderId ?? null,
      waitlistEntryId: input.waitlistEntryId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: tasks.id });

  if (!row) {
    // dedupeKey repetido: la tarea ya estaba. No es un error.
    return { id: null, created: false };
  }

  if (input.assigneeUserIds && input.assigneeUserIds.length > 0) {
    await db
      .insert(taskAssignees)
      .values(
        input.assigneeUserIds.map((userId) => ({
          taskId: row.id,
          userId,
          tenantId: input.tenantId,
        })),
      )
      .onConflictDoNothing();
  }

  if (input.checklist && input.checklist.length > 0) {
    await db.insert(taskChecklistItems).values(
      input.checklist.map((content, i) => ({
        tenantId: input.tenantId,
        taskId: row.id,
        content: content.slice(0, 300),
        order: i,
      })),
    );
  }

  await logActivity({
    tenantId: input.tenantId,
    taskId: row.id,
    authorUserId: input.createdByUserId ?? null,
    body: input.activityNote ?? activityForSource(input.source ?? 'MANUAL'),
  });

  return { id: row.id, created: true };
}

function activityForSource(source: TaskSource): string {
  if (source === 'ROUTINE') return 'Generada por una rutina programada';
  if (source === 'AUTOMATION') return 'Generada automáticamente por una regla';
  return 'Tarea creada';
}

/** Siguiente hueco al final de la columna. Los drags reescriben la columna entera. */
export async function nextBoardPosition(tenantId: string, status: TaskStatus): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${tasks.boardPosition})` })
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), eq(tasks.status, status)));
  return (row?.max ?? 0) + 1000;
}

export interface UpdateTaskInput {
  tenantId: string;
  taskId: string;
  actorUserId: string | null;
  title?: string;
  description?: string | null;
  category?: TaskCategory;
  priority?: TaskPriority;
  status?: TaskStatus;
  dueAt?: Date | null;
  dueAllDay?: boolean;
  labels?: string[];
  requiresEvidence?: boolean;
  evidenceNote?: string | null;
  assigneeUserIds?: string[];
}

/**
 * Edición de tarea + registro de qué cambió en el timeline.
 *
 * El timeline no es decorativo: es lo que convierte "yo pensaba que lo hacías
 * vos" en un hecho con hora y nombre.
 */
export async function updateTask(input: UpdateTaskInput): Promise<void> {
  const [current] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, input.taskId), eq(tasks.tenantId, input.tenantId)))
    .limit(1);
  if (!current) throw new TaskNotFoundError();

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const notes: string[] = [];

  if (input.title?.trim() && input.title !== current.title) {
    patch.title = input.title.trim().slice(0, 300);
    notes.push(`Renombrada a "${patch.title as string}"`);
  }
  if (input.description !== undefined && input.description !== current.description) {
    patch.description = input.description;
  }
  if (input.category !== undefined && input.category !== current.category) {
    patch.category = input.category;
    notes.push(`Categoría → ${input.category}`);
  }
  if (input.priority !== undefined && input.priority !== current.priority) {
    patch.priority = input.priority;
    notes.push(`Prioridad → ${input.priority}`);
  }
  if (input.labels !== undefined) patch.labels = input.labels.slice(0, 12);
  if (input.requiresEvidence !== undefined) patch.requiresEvidence = input.requiresEvidence;
  if (input.evidenceNote !== undefined) patch.evidenceNote = input.evidenceNote;
  if (input.dueAllDay !== undefined) patch.dueAllDay = input.dueAllDay;
  if (input.dueAt !== undefined) {
    const before = current.dueAt?.getTime() ?? null;
    const after = input.dueAt?.getTime() ?? null;
    if (before !== after) {
      patch.dueAt = input.dueAt;
      notes.push(input.dueAt ? `Vencimiento → ${input.dueAt.toISOString()}` : 'Sin vencimiento');
    }
  }

  if (input.status !== undefined && input.status !== current.status) {
    const evidence = input.evidenceNote !== undefined ? input.evidenceNote : current.evidenceNote;
    const needsEvidence =
      input.requiresEvidence !== undefined ? input.requiresEvidence : current.requiresEvidence;
    if (input.status === 'DONE' && needsEvidence && !evidence?.trim()) {
      throw new TaskEvidenceRequiredError();
    }
    patch.status = input.status;
    patch.completedAt = input.status === 'DONE' ? new Date() : null;
    patch.completedByUserId = input.status === 'DONE' ? input.actorUserId : null;
    if (input.status !== current.status) {
      patch.boardPosition = await nextBoardPosition(input.tenantId, input.status);
    }
    notes.push(`Estado ${current.status} → ${input.status}`);
  }

  await db
    .update(tasks)
    .set(patch)
    .where(and(eq(tasks.id, input.taskId), eq(tasks.tenantId, input.tenantId)));

  if (input.assigneeUserIds !== undefined) {
    await db
      .delete(taskAssignees)
      .where(
        and(eq(taskAssignees.taskId, input.taskId), eq(taskAssignees.tenantId, input.tenantId)),
      );
    if (input.assigneeUserIds.length > 0) {
      await db
        .insert(taskAssignees)
        .values(
          input.assigneeUserIds.map((userId) => ({
            taskId: input.taskId,
            userId,
            tenantId: input.tenantId,
          })),
        )
        .onConflictDoNothing();
    }
    notes.push(
      input.assigneeUserIds.length > 0
        ? `Asignados actualizados (${input.assigneeUserIds.length})`
        : 'Sin asignar',
    );
  }

  if (notes.length > 0) {
    await logActivity({
      tenantId: input.tenantId,
      taskId: input.taskId,
      authorUserId: input.actorUserId,
      body: notes.join(' · '),
    });
  }
}

/**
 * Reordena una columna completa del tablero.
 *
 * El cliente manda el orden final de la columna después del drag, no un índice:
 * así dos personas arrastrando a la vez convergen al último orden escrito en
 * vez de dejar posiciones a medias.
 */
export async function reorderColumn(args: {
  tenantId: string;
  status: TaskStatus;
  orderedIds: string[];
  actorUserId: string | null;
}): Promise<{ blocked: { id: string; title: string }[] }> {
  const { tenantId, status, orderedIds } = args;
  if (orderedIds.length === 0) return { blocked: [] };

  const owned = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      requiresEvidence: tasks.requiresEvidence,
      evidenceNote: tasks.evidenceNote,
    })
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), inArray(tasks.id, orderedIds)));

  // Arrastrar a "Hecho" no puede saltarse la evidencia: una rutina de
  // esterilización cerrada sin registro es exactamente lo que hay que evitar.
  const blocked = owned.filter(
    (r) =>
      status === 'DONE' && r.status !== 'DONE' && r.requiresEvidence && !r.evidenceNote?.trim(),
  );
  const blockedIds = new Set(blocked.map((r) => r.id));
  const ownedIds = new Set(owned.filter((r) => !blockedIds.has(r.id)).map((r) => r.id));
  const moved = owned.filter((r) => r.status !== status && !blockedIds.has(r.id)).map((r) => r.id);

  let position = 1000;
  for (const id of orderedIds) {
    if (!ownedIds.has(id)) continue;
    await db
      .update(tasks)
      .set({
        status,
        boardPosition: position,
        // Al salir de "Hecho" la tarea vuelve a estar abierta.
        completedAt: status === 'DONE' ? sql`coalesce(${tasks.completedAt}, now())` : null,
        completedByUserId: status === 'DONE' ? args.actorUserId : null,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)));
    position += 1000;
  }

  for (const id of moved) {
    await logActivity({
      tenantId,
      taskId: id,
      authorUserId: args.actorUserId,
      body: `Movida a ${status}`,
    });
  }

  return { blocked: blocked.map((r) => ({ id: r.id, title: r.title })) };
}

export async function archiveTask(args: {
  tenantId: string;
  taskId: string;
  actorUserId: string | null;
}): Promise<void> {
  const res = await db
    .update(tasks)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tasks.id, args.taskId), eq(tasks.tenantId, args.tenantId)))
    .returning({ id: tasks.id });
  if (res.length === 0) throw new TaskNotFoundError();
  await logActivity({
    tenantId: args.tenantId,
    taskId: args.taskId,
    authorUserId: args.actorUserId,
    body: 'Tarea archivada',
  });
}

// ─── Checklist ───────────────────────────────────────────────────────────────

export async function addChecklistItem(args: {
  tenantId: string;
  taskId: string;
  content: string;
}): Promise<string> {
  const [maxRow] = await db
    .select({ max: sql<number | null>`max(${taskChecklistItems.order})` })
    .from(taskChecklistItems)
    .where(eq(taskChecklistItems.taskId, args.taskId));
  const [row] = await db
    .insert(taskChecklistItems)
    .values({
      tenantId: args.tenantId,
      taskId: args.taskId,
      content: args.content.trim().slice(0, 300),
      order: (maxRow?.max ?? -1) + 1,
    })
    .returning({ id: taskChecklistItems.id });
  if (!row) throw new TaskNotFoundError();
  return row.id;
}

export async function setChecklistItemDone(args: {
  tenantId: string;
  itemId: string;
  done: boolean;
  actorUserId: string | null;
}): Promise<void> {
  await db
    .update(taskChecklistItems)
    .set({
      done: args.done,
      doneAt: args.done ? new Date() : null,
      doneByUserId: args.done ? args.actorUserId : null,
    })
    .where(
      and(eq(taskChecklistItems.id, args.itemId), eq(taskChecklistItems.tenantId, args.tenantId)),
    );
}

export async function deleteChecklistItem(args: {
  tenantId: string;
  itemId: string;
}): Promise<void> {
  await db
    .delete(taskChecklistItems)
    .where(
      and(eq(taskChecklistItems.id, args.itemId), eq(taskChecklistItems.tenantId, args.tenantId)),
    );
}

// ─── Comentarios y timeline ──────────────────────────────────────────────────

export async function addComment(args: {
  tenantId: string;
  taskId: string;
  authorUserId: string | null;
  body: string;
}): Promise<string> {
  const [row] = await db
    .insert(taskComments)
    .values({
      tenantId: args.tenantId,
      taskId: args.taskId,
      authorUserId: args.authorUserId,
      kind: 'comment',
      body: args.body.trim().slice(0, 4000),
    })
    .returning({ id: taskComments.id });
  if (!row) throw new TaskNotFoundError();
  await db
    .update(tasks)
    .set({ updatedAt: new Date() })
    .where(and(eq(tasks.id, args.taskId), eq(tasks.tenantId, args.tenantId)));
  return row.id;
}

export async function logActivity(args: {
  tenantId: string;
  taskId: string;
  authorUserId: string | null;
  body: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await db
    .insert(taskComments)
    .values({
      tenantId: args.tenantId,
      taskId: args.taskId,
      authorUserId: args.authorUserId,
      kind: 'activity',
      body: args.body.slice(0, 500),
      meta: args.meta ?? {},
    })
    .catch((err) => {
      // El timeline nunca debe tumbar la operación principal.
      console.error('[tasks] activity log failed', err);
    });
}
