import 'server-only';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  taskAssignees,
  taskAutomationRules,
  taskChecklistItems,
  taskComments,
  taskTemplateItems,
  taskTemplates,
  tasks,
  users,
} from '@/lib/db/schema';
import type {
  ChecklistItemDTO,
  TaskAutomationRuleDTO,
  TaskCommentDTO,
  TaskDTO,
  TaskDetailDTO,
  TaskMember,
  TaskStatsDTO,
  TaskTemplateDTO,
} from '@/lib/tasks/types';
import { addDaysToKey, localDateKey, parseDateKey, zonedToUtc } from '@/lib/tasks/tz';
import { listTenantMembersSynced } from '@/lib/tenant-members';

const BOARD_LIMIT = 400;

/**
 * Fin del día en la zona horaria de la CLÍNICA, no la del proceso.
 *
 * El worker corre en UTC: sin esto, "vence hoy" se cortaba a las 00:00 UTC,
 * o sea a la una o dos de la madrugada en España. Justo el error que `tz.ts`
 * evita en el resto del módulo.
 */
function endOfClinicDay(now: Date, timezone: string): Date {
  const parts = parseDateKey(localDateKey(now, timezone));
  if (!parts) {
    const fallback = new Date(now);
    fallback.setHours(23, 59, 59, 999);
    return fallback;
  }
  // 00:00 del día siguiente menos un milisegundo.
  const next = addDaysToKey(localDateKey(now, timezone), 1);
  const p = parseDateKey(next);
  if (!p) return now;
  return new Date(zonedToUtc(p.year, p.month, p.day, 0, 0, timezone).getTime() - 1);
}

// ─── Miembros ────────────────────────────────────────────────────────────────

export async function loadTaskMembers(
  tenantId: string,
  clerkOrganizationId: string,
): Promise<TaskMember[]> {
  const members = await listTenantMembersSynced(tenantId, clerkOrganizationId);
  return members.map((m) => {
    const name = displayName(m.firstName, m.lastName, m.email);
    return {
      userId: m.userId,
      clerkUserId: m.clerkUserId,
      email: m.email,
      name,
      initials: initialsOf(name),
      role: m.role,
    };
  });
}

export function displayName(
  firstName: string | null,
  lastName: string | null,
  email: string,
): string {
  const full = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  const local = email.split('@')[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

// ─── Tablero ─────────────────────────────────────────────────────────────────

/**
 * Todo lo que el tablero necesita en una tanda.
 *
 * Cuatro queries en vez de un join gigante: las agregaciones de checklist y
 * comentarios en un solo SELECT con dos LEFT JOIN multiplican filas y obligan
 * a DISTINCT sobre todo el row. Así es más barato y más legible.
 */
export async function loadBoardTasks(tenantId: string): Promise<TaskDTO[]> {
  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), isNull(tasks.archivedAt)))
    .orderBy(asc(tasks.status), asc(tasks.boardPosition))
    .limit(BOARD_LIMIT);

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [assignRows, checklistRows, commentRows] = await Promise.all([
    db
      .select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(inArray(taskAssignees.taskId, ids)),
    db
      .select({
        taskId: taskChecklistItems.taskId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${taskChecklistItems.done})::int`,
      })
      .from(taskChecklistItems)
      .where(inArray(taskChecklistItems.taskId, ids))
      .groupBy(taskChecklistItems.taskId),
    db
      .select({
        taskId: taskComments.taskId,
        total: sql<number>`count(*) filter (where ${taskComments.kind} = 'comment')::int`,
      })
      .from(taskComments)
      .where(inArray(taskComments.taskId, ids))
      .groupBy(taskComments.taskId),
  ]);

  const assignees = new Map<string, string[]>();
  for (const a of assignRows) {
    const list = assignees.get(a.taskId) ?? [];
    list.push(a.userId);
    assignees.set(a.taskId, list);
  }
  const checklist = new Map(checklistRows.map((c) => [c.taskId, c]));
  const comments = new Map(commentRows.map((c) => [c.taskId, c.total]));

  return rows.map((r) => {
    const cl = checklist.get(r.id);
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      category: r.category,
      priority: r.priority,
      status: r.status,
      boardPosition: r.boardPosition,
      dueAt: r.dueAt?.toISOString() ?? null,
      dueAllDay: r.dueAllDay,
      completedAt: r.completedAt?.toISOString() ?? null,
      source: r.source,
      automationTrigger: r.automationTrigger,
      templateId: r.templateId,
      requiresEvidence: r.requiresEvidence,
      evidenceNote: r.evidenceNote,
      labels: r.labels ?? [],
      assigneeIds: assignees.get(r.id) ?? [],
      checklistTotal: cl?.total ?? 0,
      checklistDone: cl?.done ?? 0,
      commentCount: comments.get(r.id) ?? 0,
      patientGhlContactId: r.patientGhlContactId,
      patientName: r.patientName,
      patientPhone: r.patientPhone,
      callId: r.callId,
      whatsappConversationId: r.whatsappConversationId,
      ghlAppointmentId: r.ghlAppointmentId,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    } satisfies TaskDTO;
  });
}

export async function loadTaskDetail(
  tenantId: string,
  taskId: string,
): Promise<TaskDetailDTO | null> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, tenantId)))
    .limit(1);
  if (!row) return null;

  const [assignRows, clRows, commentRows] = await Promise.all([
    db
      .select({ userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(eq(taskAssignees.taskId, taskId)),
    db
      .select()
      .from(taskChecklistItems)
      .where(eq(taskChecklistItems.taskId, taskId))
      .orderBy(asc(taskChecklistItems.order)),
    db
      .select({
        id: taskComments.id,
        kind: taskComments.kind,
        body: taskComments.body,
        authorUserId: taskComments.authorUserId,
        authorEmail: users.email,
        createdAt: taskComments.createdAt,
      })
      .from(taskComments)
      .leftJoin(users, eq(users.id, taskComments.authorUserId))
      .where(eq(taskComments.taskId, taskId))
      .orderBy(asc(taskComments.createdAt))
      .limit(200),
  ]);

  const checklist: ChecklistItemDTO[] = clRows.map((c) => ({
    id: c.id,
    content: c.content,
    done: c.done,
    order: c.order,
  }));

  const comments: TaskCommentDTO[] = commentRows.map((c) => ({
    id: c.id,
    kind: c.kind === 'activity' ? 'activity' : 'comment',
    body: c.body,
    authorUserId: c.authorUserId,
    authorName: c.authorEmail ? displayName(null, null, c.authorEmail) : null,
    createdAt: c.createdAt.toISOString(),
  }));

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    boardPosition: row.boardPosition,
    dueAt: row.dueAt?.toISOString() ?? null,
    dueAllDay: row.dueAllDay,
    completedAt: row.completedAt?.toISOString() ?? null,
    source: row.source,
    automationTrigger: row.automationTrigger,
    templateId: row.templateId,
    requiresEvidence: row.requiresEvidence,
    evidenceNote: row.evidenceNote,
    labels: row.labels ?? [],
    assigneeIds: assignRows.map((a) => a.userId),
    checklistTotal: checklist.length,
    checklistDone: checklist.filter((c) => c.done).length,
    commentCount: comments.filter((c) => c.kind === 'comment').length,
    patientGhlContactId: row.patientGhlContactId,
    patientName: row.patientName,
    patientPhone: row.patientPhone,
    callId: row.callId,
    whatsappConversationId: row.whatsappConversationId,
    ghlAppointmentId: row.ghlAppointmentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdByUserId: row.createdByUserId,
    checklist,
    comments,
  };
}

// ─── Métricas ────────────────────────────────────────────────────────────────

/**
 * Métricas de cumplimiento. Se calculan sobre el tablero ya cargado más una
 * query de histórico (las cerradas salen del tablero cuando se archivan).
 */
export async function loadTaskStats(
  tenantId: string,
  board: TaskDTO[],
  now: Date = new Date(),
  timezone = 'Europe/Madrid',
): Promise<TaskStatsDTO> {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  const endOfToday = endOfClinicDay(now, timezone);

  // Vencidas / hoy / próximas se cuentan en SQL sobre TODAS las tareas, no
  // sobre el array del tablero: ese viene cortado en BOARD_LIMIT y hacía que
  // los KPIs mintieran en silencio en cuanto la clínica pasaba de 400.
  const [buckets] = await db
    .select({
      overdue: sql<number>`count(*) filter (where ${tasks.dueAt} < ${now.toISOString()}::timestamptz)::int`,
      today: sql<number>`count(*) filter (where ${tasks.dueAt} >= ${now.toISOString()}::timestamptz and ${tasks.dueAt} <= ${endOfToday.toISOString()}::timestamptz)::int`,
      upcoming: sql<number>`count(*) filter (where ${tasks.dueAt} > ${endOfToday.toISOString()}::timestamptz)::int`,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.tenantId, tenantId),
        isNull(tasks.archivedAt),
        sql`${tasks.status} <> 'DONE'`,
        isNotNull(tasks.dueAt),
      ),
    );

  const [closedRows] = await db
    .select({
      doneThisWeek: sql<number>`count(*) filter (where ${tasks.completedAt} >= ${weekAgo.toISOString()}::timestamptz)::int`,
      avgHours: sql<
        number | null
      >`avg(extract(epoch from (${tasks.completedAt} - ${tasks.createdAt})) / 3600) filter (where ${tasks.completedAt} >= ${monthAgo.toISOString()}::timestamptz)`,
    })
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), eq(tasks.status, 'DONE')));

  // Cumplimiento: de las que vencían en los últimos 7 días, cuántas se cerraron.
  const [dueRows] = await db
    .select({
      dueCount: sql<number>`count(*)::int`,
      doneCount: sql<number>`count(*) filter (where ${tasks.status} = 'DONE')::int`,
    })
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), gte(tasks.dueAt, weekAgo), lt(tasks.dueAt, now)));

  const [sourceRows] = await db
    .select({
      manual: sql<number>`count(*) filter (where ${tasks.source} = 'MANUAL')::int`,
      routine: sql<number>`count(*) filter (where ${tasks.source} = 'ROUTINE')::int`,
      automated: sql<number>`count(*) filter (where ${tasks.source} = 'AUTOMATION')::int`,
    })
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), gte(tasks.createdAt, monthAgo)));

  const perMemberMap = new Map<string, { open: number; overdue: number; doneThisWeek: number }>();
  const bump = (userId: string, key: 'open' | 'overdue' | 'doneThisWeek') => {
    const cur = perMemberMap.get(userId) ?? { open: 0, overdue: 0, doneThisWeek: 0 };
    cur[key] += 1;
    perMemberMap.set(userId, cur);
  };
  for (const t of board) {
    for (const uid of t.assigneeIds) {
      if (t.status !== 'DONE') {
        bump(uid, 'open');
        if (t.dueAt && new Date(t.dueAt) < now) bump(uid, 'overdue');
      } else if (t.completedAt && new Date(t.completedAt) >= weekAgo) {
        bump(uid, 'doneThisWeek');
      }
    }
  }

  const dueCount = dueRows?.dueCount ?? 0;
  const doneCount = dueRows?.doneCount ?? 0;

  return {
    overdue: buckets?.overdue ?? 0,
    today: buckets?.today ?? 0,
    upcoming: buckets?.upcoming ?? 0,
    doneThisWeek: closedRows?.doneThisWeek ?? 0,
    // Sin nada que vencer en la semana no hay cumplimiento que medir. Antes
    // devolvíamos 100% y la clínica leía un dato inventado.
    complianceRate: dueCount === 0 ? null : Math.round((doneCount / dueCount) * 100),
    avgCloseHours:
      closedRows?.avgHours === null || closedRows?.avgHours === undefined
        ? null
        : Math.round(Number(closedRows.avgHours) * 10) / 10,
    manual: sourceRows?.manual ?? 0,
    routine: sourceRows?.routine ?? 0,
    automated: sourceRows?.automated ?? 0,
    perMember: [...perMemberMap.entries()].map(([userId, v]) => ({ userId, ...v })),
  };
}

/**
 * Contador del sidebar: lo que me toca a mí hoy o ya venció.
 * Barato a propósito — corre en cada render del layout.
 */
export async function countActionableTasks(
  tenantId: string,
  internalUserId: string | null,
  now: Date = new Date(),
  timezone = 'Europe/Madrid',
): Promise<number> {
  const endOfToday = endOfClinicDay(now, timezone);

  const conds = [
    eq(tasks.tenantId, tenantId),
    isNull(tasks.archivedAt),
    sql`${tasks.status} <> 'DONE'`,
    lt(tasks.dueAt, endOfToday),
  ];

  if (!internalUserId) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(...conds));
    return row?.n ?? 0;
  }

  // Mías o sin dueño: una tarea sin asignar también es responsabilidad de todos.
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${tasks.id})::int` })
    .from(tasks)
    .leftJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
    .where(
      and(...conds, or(eq(taskAssignees.userId, internalUserId), isNull(taskAssignees.taskId))),
    );
  return row?.n ?? 0;
}

// ─── Rutinas y automatizaciones ──────────────────────────────────────────────

export async function loadTemplates(tenantId: string): Promise<TaskTemplateDTO[]> {
  const rows = await db
    .select()
    .from(taskTemplates)
    .where(eq(taskTemplates.tenantId, tenantId))
    .orderBy(asc(taskTemplates.category), asc(taskTemplates.name));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);

  const [itemRows, statRows] = await Promise.all([
    db
      .select()
      .from(taskTemplateItems)
      .where(inArray(taskTemplateItems.templateId, ids))
      .orderBy(asc(taskTemplateItems.order)),
    db
      .select({
        templateId: tasks.templateId,
        generated: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${tasks.status} = 'DONE')::int`,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.tenantId, tenantId),
          inArray(tasks.templateId, ids),
          gte(tasks.createdAt, monthAgo),
        ),
      )
      .groupBy(tasks.templateId),
  ]);

  const itemsByTemplate = new Map<string, typeof itemRows>();
  for (const it of itemRows) {
    const list = itemsByTemplate.get(it.templateId) ?? [];
    list.push(it);
    itemsByTemplate.set(it.templateId, list);
  }
  const statsByTemplate = new Map(
    statRows
      .filter((s): s is typeof s & { templateId: string } => s.templateId !== null)
      .map((s) => [s.templateId, s]),
  );

  return rows.map((r) => {
    const st = statsByTemplate.get(r.id);
    return {
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      category: r.category,
      priority: r.priority,
      recurrenceFreq: r.recurrenceFreq,
      recurrenceInterval: r.recurrenceInterval,
      recurrenceWeekdays: r.recurrenceWeekdays ?? [],
      recurrenceMonthDay: r.recurrenceMonthDay,
      recurrenceMonth: r.recurrenceMonth,
      dueTime: r.dueTime,
      leadDays: r.leadDays,
      defaultRole: r.defaultRole,
      defaultAssigneeUserId: r.defaultAssigneeUserId,
      requiresEvidence: r.requiresEvidence,
      enabled: r.enabled,
      isSystem: r.isSystem,
      lastMaterializedOn: r.lastMaterializedOn,
      items: (itemsByTemplate.get(r.id) ?? []).map((i) => ({
        id: i.id,
        content: i.content,
        order: i.order,
      })),
      stats: { generated: st?.generated ?? 0, completed: st?.completed ?? 0 },
    } satisfies TaskTemplateDTO;
  });
}

export async function loadAutomationRules(tenantId: string): Promise<TaskAutomationRuleDTO[]> {
  const rows = await db
    .select()
    .from(taskAutomationRules)
    .where(eq(taskAutomationRules.tenantId, tenantId))
    .orderBy(asc(taskAutomationRules.trigger));

  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const counts = await db
    .select({
      trigger: tasks.automationTrigger,
      n: sql<number>`count(*)::int`,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.tenantId, tenantId),
        eq(tasks.source, 'AUTOMATION'),
        gte(tasks.createdAt, monthAgo),
      ),
    )
    .groupBy(tasks.automationTrigger);
  const countMap = new Map(counts.filter((c) => c.trigger).map((c) => [c.trigger as string, c.n]));

  return rows.map((r) => ({
    id: r.id,
    trigger: r.trigger,
    enabled: r.enabled,
    titleTemplate: r.titleTemplate,
    descriptionTemplate: r.descriptionTemplate,
    category: r.category,
    priority: r.priority,
    dueOffsetMinutes: r.dueOffsetMinutes,
    assigneeUserId: r.assigneeUserId,
    assigneeRole: r.assigneeRole,
    requiresEvidence: r.requiresEvidence,
    params: (r.params as Record<string, unknown>) ?? {},
    generatedLast30d: countMap.get(r.trigger) ?? 0,
  }));
}

/** users.id interno a partir del id de Clerk. Null si todavía no se sincronizó. */
export async function internalUserIdFor(clerkUserId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);
  return row?.id ?? null;
}

/** Últimas tareas archivadas — el historial que la vista de rutinas muestra. */
export async function loadArchivedTasks(tenantId: string, limit = 50): Promise<TaskDTO[]> {
  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), sql`${tasks.archivedAt} is not null`))
    .orderBy(desc(tasks.archivedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    priority: r.priority,
    status: r.status,
    boardPosition: r.boardPosition,
    dueAt: r.dueAt?.toISOString() ?? null,
    dueAllDay: r.dueAllDay,
    completedAt: r.completedAt?.toISOString() ?? null,
    source: r.source,
    automationTrigger: r.automationTrigger,
    templateId: r.templateId,
    requiresEvidence: r.requiresEvidence,
    evidenceNote: r.evidenceNote,
    labels: r.labels ?? [],
    assigneeIds: [],
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    patientGhlContactId: r.patientGhlContactId,
    patientName: r.patientName,
    patientPhone: r.patientPhone,
    callId: r.callId,
    whatsappConversationId: r.whatsappConversationId,
    ghlAppointmentId: r.ghlAppointmentId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}
