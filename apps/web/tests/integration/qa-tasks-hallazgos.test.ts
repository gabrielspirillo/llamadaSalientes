// Guardas de regresión del módulo Tareas.
//
// Cada caso de aquí nació como un fallo encontrado en la verificación: el test
// afirmaba lo que el código hacía mal, para que fallara en cuanto se arreglara.
// Ya está arreglado, así que ahora afirman el comportamiento correcto. Si
// alguno vuelve a ponerse rojo, el fallo ha vuelto.

import { beforeAll, describe, expect, it } from 'vitest';

import { ensureAutomationRules } from '@/lib/tasks/automation';
import { onCallProcessed } from '@/lib/tasks/hooks';
import { countActionableTasks, loadBoardTasks, loadTaskStats } from '@/lib/tasks/queries';
import {
  TaskEvidenceRequiredError,
  archiveTask,
  createTask,
  reorderColumn,
  updateTask,
} from '@/lib/tasks/service';
import { type SeedIds, raw, seedTenant, taskRow, timeline } from './_qa-tasks-helpers';

const RUN = Math.random().toString(36).slice(2, 8);
const CLINICA = `+34900${String(Math.floor(Math.random() * 900000) + 100000)}`;
// `phone_numbers.e164` es único a nivel global: cada tenant necesita el suyo.
const CLINICA_IN = `+34901${String(Math.floor(Math.random() * 900000) + 100000)}`;
const PACIENTE = `+34677${String(Math.floor(Math.random() * 900000) + 100000)}`;

let H: SeedIds;

beforeAll(async () => {
  H = await seedTenant('hallazgos');
});

describe('Gate de evidencia — las tres vías de escritura', () => {
  it('createTask no deja nacer una tarea cerrada sin nota', async () => {
    await expect(
      createTask({
        tenantId: H.tenantId,
        title: 'nace cerrada',
        status: 'DONE',
        requiresEvidence: true,
      }),
    ).rejects.toBeInstanceOf(TaskEvidenceRequiredError);
  });

  it('createTask sí la deja nacer cerrada si trae la nota', async () => {
    const r = await createTask({
      tenantId: H.tenantId,
      title: 'nace cerrada con nota',
      status: 'DONE',
      requiresEvidence: true,
      evidenceNote: 'Ciclo 42, integrador correcto',
    });
    const row = await taskRow(r.id!);
    expect(row.status).toBe('DONE');
    expect(row.evidence_note).toBe('Ciclo 42, integrador correcto');
  });

  it('updateTask lee el flag de la fila, no del body: no se puede desactivar al cerrar', async () => {
    const t = await createTask({
      tenantId: H.tenantId,
      title: 'candado',
      requiresEvidence: true,
    });
    await expect(
      updateTask({
        tenantId: H.tenantId,
        taskId: t.id!,
        actorUserId: H.userA,
        status: 'DONE',
      }),
    ).rejects.toBeInstanceOf(TaskEvidenceRequiredError);
    expect((await taskRow(t.id!)).status).toBe('TODO');
  });
});

describe('createTask — sellado del cierre', () => {
  it('una tarea creada en DONE entra en las métricas', async () => {
    const T = await seedTenant('completed-sellado');
    const r = await createTask({
      tenantId: T.tenantId,
      title: 'cerrada al nacer',
      status: 'DONE',
      createdByUserId: T.userA,
    });
    const row = await taskRow(r.id!);
    expect(row.completed_at).not.toBeNull();
    expect(row.completed_by_user_id).toBe(T.userA);

    const board = await loadBoardTasks(T.tenantId);
    const st = await loadTaskStats(T.tenantId, board, new Date());
    expect(st.doneThisWeek).toBe(1);
  });
});

describe('reorderColumn', () => {
  it('ignora las tareas archivadas: un arrastre no las resucita', async () => {
    const t = await createTask({ tenantId: H.tenantId, title: 'archivada' });
    await archiveTask({ tenantId: H.tenantId, taskId: t.id!, actorUserId: H.userA });
    await reorderColumn({
      tenantId: H.tenantId,
      status: 'IN_PROGRESS',
      orderedIds: [t.id!],
      actorUserId: H.userA,
    });
    const row = await taskRow(t.id!);
    expect(row.status).toBe('TODO');
    expect(row.archived_at).not.toBeNull();
  });

  it('preserva quién cerró la tarea al reordenar la columna Hecho', async () => {
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
    // Reordenar no es cerrar: la trazabilidad de cumplimiento se respeta.
    expect((await taskRow(t.id!)).completed_by_user_id).toBe(H.userB);
  });
});

describe('updateTask y archiveTask — historial limpio', () => {
  it('reenviar el mismo título con espacios no cuenta como renombrado', async () => {
    const t = await createTask({ tenantId: H.tenantId, title: 'Mismo título' });
    await updateTask({
      tenantId: H.tenantId,
      taskId: t.id!,
      actorUserId: H.userA,
      title: '  Mismo título  ',
    });
    expect(await timeline(t.id!)).not.toContain('Renombrada a "Mismo título"');
    expect((await taskRow(t.id!)).title).toBe('Mismo título');
  });

  it('archivar es idempotente: no re-sella la fecha ni duplica el historial', async () => {
    const t = await createTask({ tenantId: H.tenantId, title: 'doble archivo' });
    await archiveTask({ tenantId: H.tenantId, taskId: t.id!, actorUserId: H.userA });
    const first = (await taskRow(t.id!)).archived_at as Date;
    await archiveTask({ tenantId: H.tenantId, taskId: t.id!, actorUserId: H.userA });
    const second = (await taskRow(t.id!)).archived_at as Date;
    expect(second.getTime()).toBe(first.getTime());
    expect((await timeline(t.id!)).filter((b) => b === 'Tarea archivada').length).toBe(1);
  });
});

describe('Asignados — solo miembros del propio tenant', () => {
  it('createTask descarta un users.id de otra clínica', async () => {
    const otro = await seedTenant('ajeno');
    const r = await createTask({
      tenantId: H.tenantId,
      title: 'asignado ajeno',
      assigneeUserIds: [otro.userA, H.userB],
    });
    const rows = await raw<{ user_id: string }[]>`
      select user_id from task_assignees where task_id = ${r.id!}`;
    expect(rows.map((x) => x.user_id)).toEqual([H.userB]);
  });
});

describe('KPIs con más tareas que el límite del tablero', () => {
  it('las métricas cuentan en SQL, no sobre el tablero recortado', async () => {
    const T = await seedTenant('limite');
    const due = '2026-06-14T10:00:00Z';
    for (let i = 0; i < 405; i += 1) {
      await raw`
        insert into tasks (tenant_id, title, status, due_at, board_position)
        values (${T.tenantId}, ${`carga-${i}`}, 'TODO', ${due}::timestamptz, ${1000 + i})`;
    }
    const now = new Date('2026-06-15T12:00:00Z');
    const board = await loadBoardTasks(T.tenantId);
    expect(board.length).toBe(400); // el tablero sigue acotado, a propósito

    const st = await loadTaskStats(T.tenantId, board, now, 'Europe/Madrid');
    // Antes decía 400 porque derivaba del array cortado.
    expect(st.overdue).toBe(405);
    expect(await countActionableTasks(T.tenantId, null, now, 'Europe/Madrid')).toBe(405);
  });
});

describe('KPIs en la zona horaria de la clínica', () => {
  it('lo que en Madrid ya es mañana no cuenta como hoy', async () => {
    const T = await seedTenant('tz'); // clinic_settings.timezone = Europe/Madrid
    // 22:30Z del 15 de julio = 00:30 del 16 en Madrid → para la clínica, mañana.
    await raw`
      insert into tasks (tenant_id, title, status, due_at)
      values (${T.tenantId}, 'madrugada', 'TODO', '2026-07-15T22:30:00Z'::timestamptz)`;
    const board = await loadBoardTasks(T.tenantId);
    const st = await loadTaskStats(
      T.tenantId,
      board,
      new Date('2026-07-15T12:00:00Z'),
      'Europe/Madrid',
    );
    expect(st.today).toBe(0);
    expect(st.upcoming).toBe(1);
  });
});

describe('MISSED_CALL distingue la dirección de la llamada', () => {
  it('una llamada saliente corta no genera "Devolver llamada"', async () => {
    const T = await seedTenant('outbound');
    await ensureAutomationRules(T.tenantId);
    await raw`
      insert into phone_numbers (tenant_id, e164, twilio_sid)
      values (${T.tenantId}, ${CLINICA}, ${`PN${RUN}`})`;
    await raw`
      insert into patients_cache (tenant_id, ghl_contact_id, first_name, last_name, phone)
      values (${T.tenantId}, 'ghl-out', 'Nora', 'Salas', ${PACIENTE})`;
    // La clínica llama al paciente y este no atiende (5 s).
    await raw`
      insert into calls (tenant_id, retell_call_id, from_number, to_number, ghl_contact_id,
                         started_at, duration_seconds, status)
      values (${T.tenantId}, ${`out-${RUN}`}, ${CLINICA}, ${PACIENTE}, 'ghl-out',
              now(), 5, 'ended')`;
    await onCallProcessed({ tenantId: T.tenantId, retellCallId: `out-${RUN}` });
    const rows = await raw<{ title: string }[]>`
      select title from tasks
      where tenant_id = ${T.tenantId} and automation_trigger = 'MISSED_CALL'`;
    expect(rows).toEqual([]);
  });

  it('una llamada entrante corta sí la genera', async () => {
    const T = await seedTenant('inbound');
    await ensureAutomationRules(T.tenantId);
    await raw`
      insert into phone_numbers (tenant_id, e164, twilio_sid)
      values (${T.tenantId}, ${CLINICA_IN}, ${`PNin${RUN}`})`;
    await raw`
      insert into patients_cache (tenant_id, ghl_contact_id, first_name, last_name, phone)
      values (${T.tenantId}, 'ghl-in', 'Nora', 'Salas', ${PACIENTE})`;
    await raw`
      insert into calls (tenant_id, retell_call_id, from_number, to_number, ghl_contact_id,
                         started_at, duration_seconds, status)
      values (${T.tenantId}, ${`in-${RUN}`}, ${PACIENTE}, ${CLINICA_IN}, 'ghl-in',
              now(), 5, 'ended')`;
    await onCallProcessed({ tenantId: T.tenantId, retellCallId: `in-${RUN}` });
    const rows = await raw<{ title: string }[]>`
      select title from tasks
      where tenant_id = ${T.tenantId} and automation_trigger = 'MISSED_CALL'`;
    expect(rows.map((r) => r.title)).toEqual(['Devolver llamada a Nora Salas']);
  });
});
