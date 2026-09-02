import 'server-only';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  taskAssignees,
  taskChecklistItems,
  taskComments,
  tasks,
  tenantMemberships,
} from '@/lib/db/schema';
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
  /** Obligatoria si se crea ya cerrada y `requiresEvidence` está activo. */
  evidenceNote?: string | null;
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
  /** Puente con Mensajes: de qué mensaje y de qué canal salió esta tarea. */
  imChannelId?: string | null;
  imMessageId?: string | null;
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
  const requiresEvidence = input.requiresEvidence ?? false;

  // El candado de evidencia también aplica al alta: si no, se podía crear la
  // rutina de esterilización ya cerrada y sin registro, que es justo lo que
  // el candado existe para impedir.
  if (status === 'DONE' && requiresEvidence && !input.evidenceNote?.trim()) {
    throw new TaskEvidenceRequiredError();
  }

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
      requiresEvidence,
      evidenceNote: input.evidenceNote ?? null,
      labels: input.labels ?? [],
      createdByUserId: input.createdByUserId ?? null,
      // Nacer en DONE sin sellar el cierre dejaba la tarea invisible para
      // "cerradas esta semana" y para el tiempo medio de cierre.
      completedAt: status === 'DONE' ? new Date() : null,
      completedByUserId: status === 'DONE' ? (input.createdByUserId ?? null) : null,
      patientGhlContactId: input.patientGhlContactId ?? null,
      patientName: input.patientName ?? null,
      patientPhone: input.patientPhone ?? null,
      callId: input.callId ?? null,
      whatsappConversationId: input.whatsappConversationId ?? null,
      ghlAppointmentId: input.ghlAppointmentId ?? null,
      reminderId: input.reminderId ?? null,
      waitlistEntryId: input.waitlistEntryId ?? null,
      imChannelId: input.imChannelId ?? null,
      imMessageId: input.imMessageId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: tasks.id });

  if (!row) {
    // dedupeKey repetido: la tarea ya estaba. No es un error.
    return { id: null, created: false };
  }

  const assignees = await membersOfTenant(input.tenantId, input.assigneeUserIds ?? []);
  if (assignees.length > 0) {
    await db
      .insert(taskAssignees)
      .values(
        assignees.map((userId) => ({
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

  // Mensajes: a quien le cae una tarea se le avisa en el chat. Idempotente por
  // dedupeKey, best-effort — nunca puede tumbar el alta.
  void notifyAssigned({
    tenantId: input.tenantId,
    taskId: row.id,
    title: input.title,
    assigneeUserIds: input.assigneeUserIds ?? [],
    actorUserId: input.createdByUserId ?? null,
    dueAt: input.dueAt ?? null,
  });

  return { id: row.id, created: true };
}

/**
 * Aviso de asignación al módulo Mensajes.
 *
 * Aislado en su propia función y sin await en los call sites: el tablero no
 * puede quedarse esperando a que el chat responda, ni fallar si no responde.
 * La idempotencia la da el `dedupeKey` por (tarea, persona).
 */
function notifyAssigned(args: {
  tenantId: string;
  taskId: string;
  title: string;
  assigneeUserIds: string[];
  actorUserId: string | null;
  dueAt: Date | null;
}): void {
  if (args.assigneeUserIds.length === 0) return;
  void (async () => {
    try {
      const { postTaskAssigned } = await import('@/lib/messaging/bot');
      await postTaskAssigned(args);
    } catch (err) {
      console.warn('[tasks] aviso de asignación falló', (err as Error).message);
    }
  })();
}

function activityForSource(source: TaskSource): string {
  if (source === 'ROUTINE') return 'Generada por una rutina programada';
  if (source === 'AUTOMATION') return 'Generada automáticamente por una regla';
  return 'Tarea creada';
}

/**
 * Filtra una lista de asignados dejando solo los que son miembros de ESTE
 * tenant. Sin esto se podía persistir el `users.id` de otra clínica: no
 * filtra datos, pero deja tareas con dueños fantasma.
 */
async function membersOfTenant(tenantId: string, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ userId: tenantMemberships.userId })
    .from(tenantMemberships)
    .where(
      and(eq(tenantMemberships.tenantId, tenantId), inArray(tenantMemberships.userId, userIds)),
    );
  return rows.map((r) => r.userId);
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

  // Comparamos ya recortado: reenviar el mismo título con espacios de más no
  // es un cambio y no tiene que ensuciar el historial.
  const nextTitle = input.title?.trim().slice(0, 300);
  if (nextTitle && nextTitle !== current.title) {
    patch.title = nextTitle;
    notes.push(`Renombrada a "${nextTitle}"`);
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
    // `requiresEvidence` se lee SIEMPRE de la fila guardada. Tomarlo del body
    // permitía cerrar cualquier tarea mandando `requiresEvidence: false` en el
    // mismo PATCH, que vaciaba el candado por completo.
    const evidence = input.evidenceNote !== undefined ? input.evidenceNote : current.evidenceNote;
    if (input.status === 'DONE' && current.requiresEvidence && !evidence?.trim()) {
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
    const assignees = await membersOfTenant(input.tenantId, input.assigneeUserIds);
    if (assignees.length > 0) {
      await db
        .insert(taskAssignees)
        .values(
          assignees.map((userId) => ({
            taskId: input.taskId,
            userId,
            tenantId: input.tenantId,
          })),
        )
        .onConflictDoNothing();
    }
    notes.push(
      assignees.length > 0 ? `Asignados actualizados (${assignees.length})` : 'Sin asignar',
    );
    notifyAssigned({
      tenantId: input.tenantId,
      taskId: input.taskId,
      title: input.title?.trim() || current.title,
      assigneeUserIds: input.assigneeUserIds,
      actorUserId: input.actorUserId,
      dueAt: input.dueAt !== undefined ? input.dueAt : current.dueAt,
    });
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
    .where(
      and(
        eq(tasks.tenantId, tenantId),
        inArray(tasks.id, orderedIds),
        // Una tarea archivada no está en ningún tablero: un arrastre no puede
        // devolverla a la vida.
        isNull(tasks.archivedAt),
      ),
    );

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
        // Preservamos quién la cerró de verdad: reordenar la columna "Hecho"
        // no puede reescribir la trazabilidad de cumplimiento.
        completedByUserId:
          status === 'DONE' ? sql`coalesce(${tasks.completedByUserId}, ${args.actorUserId})` : null,
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
  // `isNull(archivedAt)` hace la operación idempotente: archivar dos veces no
  // vuelve a sellar la fecha ni duplica la entrada del historial.
  const res = await db
    .update(tasks)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(eq(tasks.id, args.taskId), eq(tasks.tenantId, args.tenantId), isNull(tasks.archivedAt)),
    )
    .returning({ id: tasks.id });
  if (res.length === 0) {
    // O no existe, o ya estaba archivada. Distinguimos para no mentir.
    const [exists] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, args.taskId), eq(tasks.tenantId, args.tenantId)))
      .limit(1);
    if (!exists) throw new TaskNotFoundError();
    return;
  }
  await logActivity({
    tenantId: args.tenantId,
    taskId: args.taskId,
    authorUserId: args.actorUserId,
    body: 'Tarea archivada',
  });
}

/**
 * Corta en el servicio, no solo en la ruta HTTP: cualquier llamador nuevo
 * hereda la comprobación en vez de tener que acordarse de hacerla.
 */
async function assertTaskBelongsToTenant(tenantId: string, taskId: string): Promise<void> {
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new TaskNotFoundError();
}

// ─── Checklist ───────────────────────────────────────────────────────────────

export async function addChecklistItem(args: {
  tenantId: string;
  taskId: string;
  content: string;
}): Promise<string> {
  await assertTaskBelongsToTenant(args.tenantId, args.taskId);
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
  await assertTaskBelongsToTenant(args.tenantId, args.taskId);
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

  // Mensajes: el comentario también va al hilo `CONTEXT` de la tarea, para que
  // la conversación viva donde la mira el equipo. Best-effort y sin await.
  void (async () => {
    try {
      const [t] = await db
        .select({ title: tasks.title })
        .from(tasks)
        .where(and(eq(tasks.id, args.taskId), eq(tasks.tenantId, args.tenantId)))
        .limit(1);
      const { postTaskThreadComment } = await import('@/lib/messaging/bot');
      await postTaskThreadComment({
        tenantId: args.tenantId,
        taskId: args.taskId,
        taskTitle: t?.title ?? 'Tarea',
        authorUserId: args.authorUserId,
        body: args.body.trim().slice(0, 4000),
      });
    } catch (err) {
      console.warn('[tasks] espejo del comentario al hilo falló', (err as Error).message);
    }
  })();

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
