// Casos borde que documentan comportamiento defectuoso o dudoso.
// Cada test afirma lo que el código HACE HOY, con el comentario de lo que
// debería hacer. Si alguien arregla el bug, este test falla — que es la idea.

import { beforeAll, describe, expect, it } from 'vitest';

import { ensureAutomationRules } from '@/lib/tasks/automation';
import { onCallProcessed } from '@/lib/tasks/hooks';
import { countActionableTasks, loadBoardTasks, loadTaskStats } from '@/lib/tasks/queries';
import { archiveTask, createTask, reorderColumn, updateTask } from '@/lib/tasks/service';
import { type SeedIds, raw, seedTenant, taskRow, timeline } from './_qa-tasks-helpers';

const RUN = Math.random().toString(36).slice(2, 8);
const CLINICA = `+34900${String(Math.floor(Math.random() * 900000) + 100000)}`;
const PACIENTE = `+34677${String(Math.floor(Math.random() * 900000) + 100000)}`;

let H: SeedIds;

beforeAll(async () => {
  H = await seedTenant('hallazgos');
});

describe('Hallazgos — gate de evidencia', () => {
  it('createTask permite nacer en DONE con requires_evidence y sin nota', async () => {
    const r = await createTask({
      tenantId: H.tenantId,
      title: 'nace cerrada',
      status: 'DONE',
      requiresEvidence: true,
    });
    const row = await taskRow(r.id!);
    expect(row.status).toBe('DONE'); // ← debería estar bloqueado o exigir nota
    expect(row.evidence_note).toBeNull();
  });

  it('una tarea creada en DONE queda con completed_at NULL y no entra en las métricas', async () => {
    const T = await seedTenant('completed-null');
    const r = await createTask({ tenantId: T.tenantId, title: 'cerrada al nacer', status: 'DONE' });
    const row = await taskRow(r.id!);
    expect(row.completed_at).toBeNull(); // ← debería sellarse al crear
    const board = await loadBoardTasks(T.tenantId);
    const st = await loadTaskStats(T.tenantId, board, new Date());
    expect(st.doneThisWeek).toBe(0); // se cerró, pero el KPI no la ve
    expect(st.avgCloseHours).toBeNull();
  });
});

describe('Hallazgos — reorderColumn', () => {
  it('resucita tareas archivadas: les cambia estado y posición', async () => {
    const t = await createTask({ tenantId: H.tenantId, title: 'archivada-resucitada' });
    await archiveTask({ tenantId: H.tenantId, taskId: t.id!, actorUserId: H.userA });
    await reorderColumn({
      tenantId: H.tenantId,
      status: 'IN_PROGRESS',
      orderedIds: [t.id!],
      actorUserId: H.userA,
    });
    const row = await taskRow(t.id!);
    expect(row.status).toBe('IN_PROGRESS'); // ← debería ignorar las archivadas
    expect(row.archived_at).not.toBeNull();
  });

  it('reordenar dentro de DONE re-firma completed_by aunque la cerrara otra persona', async () => {
    const t = await createTask({ tenantId: H.tenantId, title: 'firma' });
    await updateTask({
      tenantId: H.tenantId,
      taskId: t.id!,
      actorUserId: H.userB,
      status: 'DONE',
    });
    expect((await taskRow(t.id!)).completed_by_user_id).toBe(H.userB);
    await reorderColumn({
      tenantId: H.tenantId,
      status: 'DONE',
      orderedIds: [t.id!],
      actorUserId: H.userC,
    });
    // completed_at se preserva (coalesce) pero la firma se pisa.
    expect((await taskRow(t.id!)).completed_by_user_id).toBe(H.userC);
  });
});

describe('Hallazgos — updateTask', () => {
  it('renombrar con solo espacios de diferencia ensucia el timeline', async () => {
    const t = await createTask({ tenantId: H.tenantId, title: 'Mismo título' });
    await updateTask({
      tenantId: H.tenantId,
      taskId: t.id!,
      actorUserId: H.userA,
      title: '  Mismo título  ',
    });
    const tl = await timeline(t.id!);
    expect(tl).toContain('Renombrada a "Mismo título"'); // ← cambio inexistente
    expect((await taskRow(t.id!)).title).toBe('Mismo título');
  });

  it('archivar dos veces vuelve a sellar archived_at y duplica la entrada', async () => {
    const t = await createTask({ tenantId: H.tenantId, title: 'doble archivo' });
    await archiveTask({ tenantId: H.tenantId, taskId: t.id!, actorUserId: H.userA });
    const first = (await taskRow(t.id!)).archived_at as Date;
    await archiveTask({ tenantId: H.tenantId, taskId: t.id!, actorUserId: H.userA });
    const second = (await taskRow(t.id!)).archived_at as Date;
    expect(second.getTime()).toBeGreaterThanOrEqual(first.getTime());
    expect((await timeline(t.id!)).filter((b) => b === 'Tarea archivada').length).toBe(2);
  });
});

describe('Hallazgos — aislamiento multi-tenant en asignados', () => {
  it('createTask acepta un users.id que no pertenece al tenant', async () => {
    const otro = await seedTenant('ajeno');
    const r = await createTask({
      tenantId: H.tenantId,
      title: 'asignado ajeno',
      assigneeUserIds: [otro.userA],
    });
    const rows = await raw<{ user_id: string }[]>`
      select user_id from task_assignees where task_id = ${r.id!}`;
    // ← debería filtrar por tenant_memberships antes de insertar
    expect(rows.map((x) => x.user_id)).toEqual([otro.userA]);
  });
});

describe('Hallazgos — BOARD_LIMIT truncando las métricas', () => {
  it('con más de 400 tareas abiertas el tablero y los KPIs se quedan cortos', async () => {
    const T = await seedTenant('limite');
    const due = '2026-06-14T10:00:00Z';
    const values = Array.from({ length: 405 }, (_, i) => i);
    for (const i of values) {
      await raw`
        insert into tasks (tenant_id, title, status, due_at, board_position)
        values (${T.tenantId}, ${`carga-${i}`}, 'TODO', ${due}::timestamptz, ${1000 + i})`;
    }
    const board = await loadBoardTasks(T.tenantId);
    expect(board.length).toBe(400); // ← se pierden 5
    const st = await loadTaskStats(T.tenantId, board, new Date('2026-06-15T12:00:00Z'));
    expect(st.overdue).toBe(400); // deberían ser 405
    // El contador del sidebar sí cuenta en SQL: no coincide con el tablero.
    expect(await countActionableTasks(T.tenantId, null, new Date('2026-06-15T12:00:00Z'))).toBe(405);
  });
});

describe('Hallazgos — timezone del servidor en los KPIs', () => {
  it('"hoy" se calcula con la hora del servidor, no con la de la clínica', async () => {
    const T = await seedTenant('tz-leak'); // clinic_settings.timezone = Europe/Madrid
    // 2026-07-15T22:30Z = 2026-07-16 00:30 en Madrid → para la clínica es MAÑANA
    await raw`
      insert into tasks (tenant_id, title, status, due_at)
      values (${T.tenantId}, 'madrugada', 'TODO', '2026-07-15T22:30:00Z'::timestamptz)`;
    const board = await loadBoardTasks(T.tenantId);
    const st = await loadTaskStats(T.tenantId, board, new Date('2026-07-15T12:00:00Z'));
    expect(st.today).toBe(1); // ← con TZ=UTC en el proceso lo cuenta como hoy
    expect(st.upcoming).toBe(0);
  });
});

describe('Hallazgos — MISSED_CALL no distingue dirección', () => {
  it('una llamada saliente corta genera "Devolver llamada"', async () => {
    const T = await seedTenant('outbound');
    await ensureAutomationRules(T.tenantId);
    await raw`
      insert into phone_numbers (tenant_id, e164, twilio_sid)
      values (${T.tenantId}, ${CLINICA}, ${`PN${RUN}`})`;
    await raw`
      insert into patients_cache (tenant_id, ghl_contact_id, first_name, last_name, phone)
      values (${T.tenantId}, 'ghl-out', 'Nora', 'Salas', ${PACIENTE})`;
    // Saliente: la clínica llama al paciente y este no atiende (5 s).
    await raw`
      insert into calls (tenant_id, retell_call_id, from_number, to_number, ghl_contact_id,
                         started_at, duration_seconds, status)
      values (${T.tenantId}, ${`out-${RUN}`}, ${CLINICA}, ${PACIENTE}, 'ghl-out',
              now(), 5, 'ended')`;
    await onCallProcessed({ tenantId: T.tenantId, retellCallId: `out-${RUN}` });
    const rows = await raw<{ title: string }[]>`
      select title from tasks
      where tenant_id = ${T.tenantId} and automation_trigger = 'MISSED_CALL'`;
    // ← `calls` no guarda dirección: la heurística <20 s la trata como perdida
    expect(rows.map((r) => r.title)).toEqual(['Devolver llamada a Nora Salas']);
  });
});
