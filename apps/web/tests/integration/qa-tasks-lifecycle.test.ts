import { beforeAll, describe, expect, it } from 'vitest';

import { loadArchivedTasks, loadBoardTasks, loadTaskDetail } from '@/lib/tasks/queries';
import {
  TaskEvidenceRequiredError,
  addChecklistItem,
  addComment,
  archiveTask,
  createTask,
  deleteChecklistItem,
  reorderColumn,
  setChecklistItemDone,
  updateTask,
} from '@/lib/tasks/service';
import { type SeedIds, raw, seedTenant, taskRow, timeline } from './_qa-tasks-helpers';

let S: SeedIds;

beforeAll(async () => {
  S = await seedTenant('life');
});

describe('1. Alta y ciclo de vida', () => {
  it('createTask crea la tarea con sus vínculos y abre el timeline', async () => {
    const res = await createTask({
      tenantId: S.tenantId,
      title: '   Llamar a Marta   ',
      description: 'desc',
      category: 'PATIENT',
      priority: 'HIGH',
      dueAt: new Date('2026-09-10T10:00:00Z'),
      assigneeUserIds: [S.userA],
      checklist: ['uno', 'dos'],
      createdByUserId: S.userA,
      labels: ['recepción'],
    });
    expect(res.created).toBe(true);
    const row = await taskRow(res.id!);
    expect(row.title).toBe('Llamar a Marta'); // trim aplicado
    expect(row.status).toBe('TODO');
    expect(Number(row.board_position)).toBe(1000);
    expect(await timeline(res.id!)).toEqual(['Tarea creada']);
  });

  it('updateTask registra cada cambio en el timeline', async () => {
    const { id } = await createTask({ tenantId: S.tenantId, title: 'Original' });
    await updateTask({
      tenantId: S.tenantId,
      taskId: id!,
      actorUserId: S.userA,
      title: 'Renombrada',
      priority: 'URGENT',
      category: 'COMPLIANCE',
      dueAt: new Date('2026-10-01T08:00:00Z'),
      assigneeUserIds: [S.userA, S.userB],
    });
    const row = await taskRow(id!);
    expect(row.title).toBe('Renombrada');
    expect(row.priority).toBe('URGENT');
    expect(row.category).toBe('COMPLIANCE');
    const tl = await timeline(id!);
    expect(tl.length).toBe(2);
    expect(tl[1]).toContain('Renombrada a "Renombrada"');
    expect(tl[1]).toContain('Categoría → COMPLIANCE');
    expect(tl[1]).toContain('Prioridad → URGENT');
    expect(tl[1]).toContain('Vencimiento →');
    expect(tl[1]).toContain('Asignados actualizados (2)');

    const asignados = await raw<{ user_id: string }[]>`
      select user_id from task_assignees where task_id = ${id!}`;
    expect(asignados.map((a) => a.user_id).sort()).toEqual([S.userA, S.userB].sort());
  });

  it('reorderColumn mueve entre columnas y reescribe posiciones', async () => {
    const a = await createTask({ tenantId: S.tenantId, title: 'mover-A' });
    const b = await createTask({ tenantId: S.tenantId, title: 'mover-B' });
    const out = await reorderColumn({
      tenantId: S.tenantId,
      status: 'IN_PROGRESS',
      orderedIds: [b.id!, a.id!],
      actorUserId: S.userA,
    });
    expect(out.blocked).toEqual([]);
    const rowB = await taskRow(b.id!);
    const rowA = await taskRow(a.id!);
    expect(rowB.status).toBe('IN_PROGRESS');
    expect(Number(rowB.board_position)).toBe(1000);
    expect(Number(rowA.board_position)).toBe(2000);
    expect(await timeline(a.id!)).toContain('Movida a IN_PROGRESS');
  });

  it('mover a DONE por reorderColumn sella completed_at; salir lo limpia', async () => {
    const t = await createTask({ tenantId: S.tenantId, title: 'cerrar-abrir' });
    await reorderColumn({
      tenantId: S.tenantId,
      status: 'DONE',
      orderedIds: [t.id!],
      actorUserId: S.userA,
    });
    let row = await taskRow(t.id!);
    expect(row.completed_at).not.toBeNull();
    expect(row.completed_by_user_id).toBe(S.userA);
    await reorderColumn({
      tenantId: S.tenantId,
      status: 'TODO',
      orderedIds: [t.id!],
      actorUserId: S.userA,
    });
    row = await taskRow(t.id!);
    expect(row.completed_at).toBeNull();
  });

  it('archiveTask marca archived_at, lo saca del tablero y lo registra', async () => {
    const t = await createTask({ tenantId: S.tenantId, title: 'a-archivar' });
    await archiveTask({ tenantId: S.tenantId, taskId: t.id!, actorUserId: S.userA });
    const row = await taskRow(t.id!);
    expect(row.archived_at).not.toBeNull();
    expect(await timeline(t.id!)).toContain('Tarea archivada');
    const board = await loadBoardTasks(S.tenantId);
    expect(board.find((x) => x.id === t.id)).toBeUndefined();
    const arch = await loadArchivedTasks(S.tenantId);
    expect(arch.find((x) => x.id === t.id)).toBeDefined();
  });
});

describe('2. Idempotencia por dedupeKey', () => {
  it('el segundo alta con la misma clave devuelve created:false y no duplica', async () => {
    const key = 'auto:MISSED_CALL:qa-dupe';
    const first = await createTask({ tenantId: S.tenantId, title: 'dupe', dedupeKey: key });
    const second = await createTask({ tenantId: S.tenantId, title: 'dupe', dedupeKey: key });
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: null, created: false });
    const { n } = (
      await raw<{ n: number }[]>`
      select count(*)::int as n from tasks where tenant_id = ${S.tenantId} and dedupe_key = ${key}`
    )[0]!;
    expect(n).toBe(1);
  });

  it('la misma clave en otro tenant sí crea (el índice es por tenant)', async () => {
    const other = await seedTenant('dupe-other');
    const r = await createTask({
      tenantId: other.tenantId,
      title: 'dupe',
      dedupeKey: 'auto:MISSED_CALL:qa-dupe',
    });
    expect(r.created).toBe(true);
  });
});

describe('3. Gate de evidencia', () => {
  it('updateTask a DONE sin nota lanza TaskEvidenceRequiredError', async () => {
    const t = await createTask({
      tenantId: S.tenantId,
      title: 'esterilización',
      requiresEvidence: true,
    });
    await expect(
      updateTask({
        tenantId: S.tenantId,
        taskId: t.id!,
        actorUserId: S.userA,
        status: 'DONE',
      }),
    ).rejects.toBeInstanceOf(TaskEvidenceRequiredError);
    expect((await taskRow(t.id!)).status).toBe('TODO');
  });

  it('reorderColumn a DONE devuelve la tarea en blocked y no la mueve', async () => {
    const t = await createTask({
      tenantId: S.tenantId,
      title: 'arqueo',
      requiresEvidence: true,
    });
    const libre = await createTask({ tenantId: S.tenantId, title: 'sin evidencia requerida' });
    const out = await reorderColumn({
      tenantId: S.tenantId,
      status: 'DONE',
      orderedIds: [t.id!, libre.id!],
      actorUserId: S.userA,
    });
    expect(out.blocked.map((b) => b.id)).toEqual([t.id]);
    expect((await taskRow(t.id!)).status).toBe('TODO');
    expect((await taskRow(libre.id!)).status).toBe('DONE');
  });

  it('con evidenceNote cierra por updateTask y por reorderColumn', async () => {
    const t1 = await createTask({ tenantId: S.tenantId, title: 'ev1', requiresEvidence: true });
    await updateTask({
      tenantId: S.tenantId,
      taskId: t1.id!,
      actorUserId: S.userA,
      status: 'DONE',
      evidenceNote: 'ciclo 42 OK',
    });
    expect((await taskRow(t1.id!)).status).toBe('DONE');

    const t2 = await createTask({ tenantId: S.tenantId, title: 'ev2', requiresEvidence: true });
    await updateTask({
      tenantId: S.tenantId,
      taskId: t2.id!,
      actorUserId: S.userA,
      evidenceNote: 'ticket archivado',
    });
    const out = await reorderColumn({
      tenantId: S.tenantId,
      status: 'DONE',
      orderedIds: [t2.id!],
      actorUserId: S.userA,
    });
    expect(out.blocked).toEqual([]);
    expect((await taskRow(t2.id!)).status).toBe('DONE');
  });
});

describe('4. Checklist y comentarios', () => {
  it('contadores de loadBoardTasks cuadran con el estado real', async () => {
    const t = await createTask({
      tenantId: S.tenantId,
      title: 'con-checklist',
      checklist: ['a', 'b'],
    });
    const extra = await addChecklistItem({
      tenantId: S.tenantId,
      taskId: t.id!,
      content: 'c',
    });
    await setChecklistItemDone({
      tenantId: S.tenantId,
      itemId: extra,
      done: true,
      actorUserId: S.userA,
    });
    await addComment({
      tenantId: S.tenantId,
      taskId: t.id!,
      authorUserId: S.userA,
      body: 'primer comentario',
    });

    let card = (await loadBoardTasks(S.tenantId)).find((x) => x.id === t.id);
    expect(card?.checklistTotal).toBe(3);
    expect(card?.checklistDone).toBe(1);
    // commentCount solo cuenta kind='comment', no el timeline
    expect(card?.commentCount).toBe(1);

    await setChecklistItemDone({
      tenantId: S.tenantId,
      itemId: extra,
      done: false,
      actorUserId: S.userA,
    });
    await deleteChecklistItem({ tenantId: S.tenantId, itemId: extra });
    card = (await loadBoardTasks(S.tenantId)).find((x) => x.id === t.id);
    expect(card?.checklistTotal).toBe(2);
    expect(card?.checklistDone).toBe(0);

    const detail = await loadTaskDetail(S.tenantId, t.id!);
    expect(detail?.checklist.map((c) => c.content)).toEqual(['a', 'b']);
    expect(detail?.comments.filter((c) => c.kind === 'comment').length).toBe(1);
    expect(detail?.comments.some((c) => c.kind === 'activity')).toBe(true);
  });

  it('el orden del checklist se mantiene tras altas sucesivas', async () => {
    const t = await createTask({ tenantId: S.tenantId, title: 'orden', checklist: ['x'] });
    await addChecklistItem({ tenantId: S.tenantId, taskId: t.id!, content: 'y' });
    await addChecklistItem({ tenantId: S.tenantId, taskId: t.id!, content: 'z' });
    const detail = await loadTaskDetail(S.tenantId, t.id!);
    expect(detail?.checklist.map((c) => c.content)).toEqual(['x', 'y', 'z']);
    expect(detail?.checklist.map((c) => c.order)).toEqual([0, 1, 2]);
  });
});
