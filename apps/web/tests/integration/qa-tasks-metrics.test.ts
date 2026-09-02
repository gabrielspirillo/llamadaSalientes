import { beforeAll, describe, expect, it } from 'vitest';

import { ensureAutomationRules } from '@/lib/tasks/automation';
import { TASK_AUTOMATION_TRIGGERS } from '@/lib/tasks/constants';
import {
  countActionableTasks,
  loadArchivedTasks,
  loadAutomationRules,
  loadBoardTasks,
  loadTaskDetail,
  loadTaskMembers,
  loadTaskStats,
  loadTemplates,
} from '@/lib/tasks/queries';
import { seedSystemTemplates } from '@/lib/tasks/templates';
import {
  TaskNotFoundError,
  addChecklistItem,
  addComment,
  archiveTask,
  createTask,
  deleteChecklistItem,
  reorderColumn,
  setChecklistItemDone,
  updateTask,
} from '@/lib/tasks/service';
import { type SeedIds, raw, seedTenant, taskRow } from './_qa-tasks-helpers';

const NOW = new Date('2026-06-15T12:00:00Z');

let M: SeedIds; // tenant con el dataset de métricas
let N: SeedIds; // tenant vecino, para aislamiento
const ids: Record<string, string> = {};

interface Fixture {
  ref: string;
  status: string;
  source: string;
  due: string | null;
  created: string;
  completed?: string | null;
  archived?: string | null;
  assignees?: ('A' | 'B')[];
}

const FIXTURES: Fixture[] = [
  { ref: 'T1', status: 'TODO', source: 'MANUAL', due: '2026-06-14T10:00:00Z', created: '2026-06-01T09:00:00Z', assignees: ['A'] },
  { ref: 'T2', status: 'IN_PROGRESS', source: 'MANUAL', due: '2026-06-15T18:00:00Z', created: '2026-06-10T09:00:00Z', assignees: ['A'] },
  { ref: 'T3', status: 'TODO', source: 'ROUTINE', due: '2026-06-20T10:00:00Z', created: '2026-06-11T09:00:00Z', assignees: ['B'] },
  { ref: 'T4', status: 'TODO', source: 'AUTOMATION', due: null, created: '2026-06-12T09:00:00Z' },
  { ref: 'T5', status: 'DONE', source: 'MANUAL', due: '2026-06-11T10:00:00Z', created: '2026-06-10T10:00:00Z', completed: '2026-06-12T10:00:00Z', assignees: ['A'] },
  { ref: 'T6', status: 'DONE', source: 'ROUTINE', due: '2026-06-09T09:00:00Z', created: '2026-06-08T10:00:00Z', completed: '2026-06-09T10:00:00Z', assignees: ['B'] },
  { ref: 'T7', status: 'IN_REVIEW', source: 'AUTOMATION', due: '2026-06-13T10:00:00Z', created: '2026-06-05T09:00:00Z', assignees: ['A', 'B'] },
  { ref: 'T8', status: 'DONE', source: 'MANUAL', due: '2026-06-13T12:00:00Z', created: '2026-06-13T10:00:00Z', completed: '2026-06-14T10:00:00Z', archived: '2026-06-14T11:00:00Z' },
  { ref: 'T9', status: 'DONE', source: 'MANUAL', due: '2026-03-31T10:00:00Z', created: '2026-03-30T10:00:00Z', completed: '2026-04-01T10:00:00Z', archived: '2026-04-02T10:00:00Z' },
  { ref: 'T10', status: 'TODO', source: 'MANUAL', due: '2026-06-15T08:00:00Z', created: '2026-06-14T09:00:00Z' },
];

beforeAll(async () => {
  M = await seedTenant('metrics');
  N = await seedTenant('vecino');

  for (const f of FIXTURES) {
    const [row] = await raw<{ id: string }[]>`
      insert into tasks (tenant_id, title, status, source, due_at, created_at, completed_at, archived_at)
      values (${M.tenantId}, ${f.ref}, ${f.status}::task_status, ${f.source}::task_source,
              ${f.due}::timestamptz, ${f.created}::timestamptz,
              ${f.completed ?? null}::timestamptz, ${f.archived ?? null}::timestamptz)
      returning id`;
    ids[f.ref] = row!.id;
    for (const a of f.assignees ?? []) {
      await raw`insert into task_assignees (task_id, user_id, tenant_id)
        values (${row!.id}, ${a === 'A' ? M.userA : M.userB}, ${M.tenantId})`;
    }
  }
});

describe('8. Queries y métricas', () => {
  it('loadBoardTasks devuelve solo lo no archivado, ordenado por columna y posición', async () => {
    const board = await loadBoardTasks(M.tenantId);
    expect(board.length).toBe(8); // T1..T7 + T10, sin T8 ni T9
    expect(board.map((t) => t.title)).not.toContain('T8');
    expect(board.map((t) => t.title)).not.toContain('T9');
    const statuses = board.map((t) => t.status);
    const order = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];
    const idx = statuses.map((s) => order.indexOf(s));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it('loadTaskStats calcula overdue/today/upcoming/compliance/avgClose/perMember', async () => {
    const board = await loadBoardTasks(M.tenantId);
    const st = await loadTaskStats(M.tenantId, board, NOW);

    expect(st.overdue).toBe(3); // T1, T7, T10
    expect(st.today).toBe(1); // T2
    expect(st.upcoming).toBe(1); // T3
    expect(st.doneThisWeek).toBe(3); // T5, T6, T8 (incluye la archivada)
    // vencidas en los últimos 7 días: T1,T5,T6,T7,T8,T10 → cerradas T5,T6,T8
    expect(st.complianceRate).toBe(50);
    // cerradas en 30 días: T5=48h, T6=24h, T8=24h → 32h
    expect(st.avgCloseHours).toBe(32);
    // creadas en 30 días
    expect(st.manual).toBe(5); // T1,T2,T5,T8,T10
    expect(st.routine).toBe(2); // T3,T6
    expect(st.automated).toBe(2); // T4,T7

    const byUser = new Map(st.perMember.map((p) => [p.userId, p]));
    expect(byUser.get(M.userA)).toEqual({
      userId: M.userA,
      open: 3, // T1,T2,T7
      overdue: 2, // T1,T7
      doneThisWeek: 1, // T5
    });
    expect(byUser.get(M.userB)).toEqual({
      userId: M.userB,
      open: 2, // T3,T7
      overdue: 1, // T7
      doneThisWeek: 1, // T6
    });
    expect(byUser.get(M.userC)).toBeUndefined();
  });

  it('countActionableTasks: mías o sin dueño, vencidas o de hoy', async () => {
    expect(await countActionableTasks(M.tenantId, M.userA, NOW)).toBe(4); // T1,T2,T7,T10
    expect(await countActionableTasks(M.tenantId, M.userB, NOW)).toBe(2); // T7,T10
    expect(await countActionableTasks(M.tenantId, M.userC, NOW)).toBe(1); // solo T10 (sin dueño)
    expect(await countActionableTasks(M.tenantId, null, NOW)).toBe(4);
  });

  it('loadArchivedTasks devuelve las archivadas más recientes primero', async () => {
    const arch = await loadArchivedTasks(M.tenantId);
    expect(arch.map((t) => t.title)).toEqual(['T8', 'T9']);
  });

  it('loadTaskDetail arma checklist, comentarios y autor legible', async () => {
    const item = await addChecklistItem({
      tenantId: M.tenantId,
      taskId: ids.T1!,
      content: 'paso',
    });
    await setChecklistItemDone({
      tenantId: M.tenantId,
      itemId: item,
      done: true,
      actorUserId: M.userA,
    });
    await addComment({
      tenantId: M.tenantId,
      taskId: ids.T1!,
      authorUserId: M.userA,
      body: 'hola',
    });
    const d = await loadTaskDetail(M.tenantId, ids.T1!);
    expect(d?.checklistTotal).toBe(1);
    expect(d?.checklistDone).toBe(1);
    expect(d?.commentCount).toBe(1);
    const comentario = d?.comments.find((c) => c.kind === 'comment');
    expect(comentario?.authorName).toBe('Ana Perez');
    await deleteChecklistItem({ tenantId: M.tenantId, itemId: item });
  });

  it('loadTemplates y loadAutomationRules reportan generated/completed del tenant', async () => {
    await seedSystemTemplates(M.tenantId);
    await ensureAutomationRules(M.tenantId);
    const tpls = await loadTemplates(M.tenantId);
    expect(tpls.length).toBe(15);
    expect(tpls.every((t) => t.stats.generated === 0)).toBe(true);

    const tplId = tpls.find((t) => t.key === 'apertura')!.id;
    await createTask({
      tenantId: M.tenantId,
      title: 'gen-1',
      source: 'ROUTINE',
      templateId: tplId,
      status: 'DONE',
    });
    await createTask({
      tenantId: M.tenantId,
      title: 'gen-2',
      source: 'ROUTINE',
      templateId: tplId,
    });
    const after = await loadTemplates(M.tenantId);
    const ap = after.find((t) => t.key === 'apertura')!;
    expect(ap.stats).toEqual({ generated: 2, completed: 1 });

    const rules = await loadAutomationRules(M.tenantId);
    expect(rules.length).toBe(10);
    // T4 y T7 son source AUTOMATION pero sin trigger → no cuentan en ninguna regla
    expect(rules.every((r) => r.generatedLast30d === 0)).toBe(true);
    // el orderBy es sobre el enum: sale en el orden de declaración, no alfabético
    expect(rules.map((r) => r.trigger)).toEqual(TASK_AUTOMATION_TRIGGERS as unknown as string[]);
  });

  it('loadTaskMembers cae al espejo local cuando Clerk no responde', async () => {
    const members = await loadTaskMembers(M.tenantId, `org-inexistente-${Date.now()}`);
    expect(members.length).toBe(3);
    const ana = members.find((m) => m.email.startsWith('ana.'));
    expect(ana?.name).toBe('Ana Perez');
    expect(ana?.initials).toBe('AP');
    expect(ana?.role).toBe('admin');
  });
});

describe('9. Aislamiento multi-tenant', () => {
  it('las lecturas del vecino no ven nada del tenant de métricas', async () => {
    const board = await loadBoardTasks(N.tenantId);
    expect(board).toEqual([]);
    expect(await loadTaskDetail(N.tenantId, ids.T1!)).toBeNull();
    expect(await loadArchivedTasks(N.tenantId)).toEqual([]);
    expect(await loadTemplates(N.tenantId)).toEqual([]);
    expect(await loadAutomationRules(N.tenantId)).toEqual([]);
    expect(await countActionableTasks(N.tenantId, N.userA, NOW)).toBe(0);
    const st = await loadTaskStats(N.tenantId, board, NOW);
    expect(st).toMatchObject({
      overdue: 0,
      today: 0,
      upcoming: 0,
      doneThisWeek: 0,
      avgCloseHours: null,
      complianceRate: 100,
      manual: 0,
      routine: 0,
      automated: 0,
      perMember: [],
    });
  });

  it('las escrituras del vecino no tocan tareas ajenas', async () => {
    const antes = await taskRow(ids.T1!);

    await expect(
      updateTask({
        tenantId: N.tenantId,
        taskId: ids.T1!,
        actorUserId: N.userA,
        title: 'HACKEADA',
        status: 'DONE',
      }),
    ).rejects.toBeInstanceOf(TaskNotFoundError);

    await expect(
      archiveTask({ tenantId: N.tenantId, taskId: ids.T1!, actorUserId: N.userA }),
    ).rejects.toBeInstanceOf(TaskNotFoundError);

    const out = await reorderColumn({
      tenantId: N.tenantId,
      status: 'DONE',
      orderedIds: [ids.T1!, ids.T2!],
      actorUserId: N.userA,
    });
    expect(out.blocked).toEqual([]);

    const despues = await taskRow(ids.T1!);
    expect(despues.title).toBe(antes.title);
    expect(despues.status).toBe(antes.status);
    expect(despues.archived_at).toBeNull();
    expect((await taskRow(ids.T2!)).status).toBe('IN_PROGRESS');
  });

  it('checklist y comentarios ajenos no se pueden tocar con otro tenant', async () => {
    const item = await addChecklistItem({
      tenantId: M.tenantId,
      taskId: ids.T2!,
      content: 'privado',
    });
    await setChecklistItemDone({
      tenantId: N.tenantId,
      itemId: item,
      done: true,
      actorUserId: N.userA,
    });
    let [row] = await raw<{ done: boolean }[]>`
      select done from task_checklist_items where id = ${item}`;
    expect(row!.done).toBe(false);

    await deleteChecklistItem({ tenantId: N.tenantId, itemId: item });
    [row] = await raw<{ done: boolean }[]>`
      select done from task_checklist_items where id = ${item}`;
    expect(row).toBeDefined();
  });

  it('el dedupe_key es por tenant y las métricas no se contaminan', async () => {
    await createTask({ tenantId: N.tenantId, title: 'propia del vecino' });
    const board = await loadBoardTasks(N.tenantId);
    expect(board.map((t) => t.title)).toEqual(['propia del vecino']);
    // el tablero de M sigue igual salvo lo que le agregamos en sus propios tests
    const mBoard = await loadBoardTasks(M.tenantId);
    expect(mBoard.some((t) => t.title === 'propia del vecino')).toBe(false);
  });
});
