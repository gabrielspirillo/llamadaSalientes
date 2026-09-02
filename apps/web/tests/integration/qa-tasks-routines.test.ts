import { beforeAll, describe, expect, it } from 'vitest';

import { materializeRoutinesForTenant } from '@/lib/tasks/materialize';
import { loadTemplates } from '@/lib/tasks/queries';
import { SYSTEM_TEMPLATES, seedSystemTemplates } from '@/lib/tasks/templates';
import { type SeedIds, raw, seedTenant } from './_qa-tasks-helpers';

let S: SeedIds;
let R: SeedIds;

const ANCHOR = '2025-01-01T00:00:00Z';

interface TplSpec {
  key: string;
  freq: string;
  dueTime: string;
  weekdays?: number[];
  monthDay?: number | null;
  month?: number | null;
  leadDays?: number;
  enabled?: boolean;
}

async function makeTemplate(tenantId: string, t: TplSpec): Promise<string> {
  const [row] = await raw<{ id: string }[]>`
    insert into task_templates
      (tenant_id, key, name, category, priority, recurrence_freq, recurrence_interval,
       recurrence_weekdays, recurrence_month_day, recurrence_month, due_time, lead_days,
       enabled, is_system, created_at)
    values (${tenantId}, ${t.key}, ${`T ${t.key}`}, 'ADMIN', 'MEDIUM',
       ${t.freq}::task_recurrence_freq, 1,
       ${t.weekdays ?? []}::int[], ${t.monthDay ?? null}, ${t.month ?? null},
       ${t.dueTime}, ${t.leadDays ?? 0}, ${t.enabled ?? true}, false, ${ANCHOR}::timestamptz)
    returning id`;
  return row!.id;
}

async function setMark(id: string, day: string | null): Promise<void> {
  await raw`update task_templates set last_materialized_on = ${day}::date where id = ${id}`;
}

async function tasksOf(templateId: string): Promise<{ due_at: Date; dedupe_key: string }[]> {
  return raw<{ due_at: Date; dedupe_key: string }[]>`
    select due_at, dedupe_key from tasks where template_id = ${templateId} order by due_at`;
}

beforeAll(async () => {
  S = await seedTenant('routines-seed');
  R = await seedTenant('routines-freq');
});

describe('5a. seedSystemTemplates', () => {
  it('siembra las 16 rutinas del catálogo y es idempotente', async () => {
    expect(SYSTEM_TEMPLATES.length).toBe(16);
    const n1 = await seedSystemTemplates(S.tenantId);
    expect(n1).toBe(16);
    const n2 = await seedSystemTemplates(S.tenantId);
    expect(n2).toBe(0);

    const { n } = (
      await raw<{ n: number }[]>`
      select count(*)::int as n from task_templates where tenant_id = ${S.tenantId}`
    )[0]!;
    expect(n).toBe(16);

    const { items } = (
      await raw<{ items: number }[]>`
      select count(*)::int as items from task_template_items where tenant_id = ${S.tenantId}`
    )[0]!;
    expect(items).toBe(SYSTEM_TEMPLATES.reduce((a, t) => a + t.items.length, 0));

    const tpls = await loadTemplates(S.tenantId);
    expect(tpls.length).toBe(16);
    expect(tpls.every((t) => t.isSystem)).toBe(true);
    const apertura = tpls.find((t) => t.key === 'apertura');
    expect(apertura?.items.map((i) => i.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('5b. materializeRoutinesForTenant — timezone, DST y frecuencias', () => {
  it('WEEKDAYS cae a la hora de pared correcta en invierno y en verano (Madrid)', async () => {
    const id = await makeTemplate(R.tenantId, { key: 'wd', freq: 'WEEKDAYS', dueTime: '08:30' });
    await setMark(id, '2026-01-14');
    await materializeRoutinesForTenant(R.tenantId, new Date('2026-01-15T12:00:00Z'));
    let rows = await tasksOf(id);
    expect(rows.length).toBe(1);
    // Invierno: Madrid = UTC+1 → 08:30 local = 07:30Z
    expect(rows[0]!.due_at.toISOString()).toBe('2026-01-15T07:30:00.000Z');
    expect(rows[0]!.dedupe_key).toBe(`routine:${id}:2026-01-15`);

    await setMark(id, '2026-07-14');
    await materializeRoutinesForTenant(R.tenantId, new Date('2026-07-15T12:00:00Z'));
    rows = await tasksOf(id);
    expect(rows.length).toBe(2);
    // Verano: Madrid = UTC+2 → 08:30 local = 06:30Z
    expect(rows[1]!.due_at.toISOString()).toBe('2026-07-15T06:30:00.000Z');
  });

  it('no duplica al correr dos veces (dedupe_key), aun reseteando la marca', async () => {
    const id = await makeTemplate(R.tenantId, { key: 'wd2', freq: 'WEEKDAYS', dueTime: '08:30' });
    await setMark(id, '2026-01-14');
    const a = await materializeRoutinesForTenant(R.tenantId, new Date('2026-01-15T12:00:00Z'));
    expect(a.created).toBeGreaterThanOrEqual(1);
    await setMark(id, '2026-01-14');
    await materializeRoutinesForTenant(R.tenantId, new Date('2026-01-15T12:00:00Z'));
    expect((await tasksOf(id)).length).toBe(1);
  });

  it('WEEKLY solo el día configurado', async () => {
    const id = await makeTemplate(R.tenantId, {
      key: 'wk',
      freq: 'WEEKLY',
      weekdays: [1],
      dueTime: '09:30',
    });
    await setMark(id, '2026-01-11'); // domingo
    await materializeRoutinesForTenant(R.tenantId, new Date('2026-01-15T12:00:00Z'));
    const rows = await tasksOf(id);
    expect(rows.length).toBe(1); // solo el lunes 12
    expect(rows[0]!.due_at.toISOString()).toBe('2026-01-12T08:30:00.000Z');
  });

  it('MONTHLY respeta lead_days: sin lead no aparece, con lead sí', async () => {
    const sinLead = await makeTemplate(R.tenantId, {
      key: 'mo-nolead',
      freq: 'MONTHLY',
      monthDay: 1,
      dueTime: '10:00',
      leadDays: 0,
    });
    const conLead = await makeTemplate(R.tenantId, {
      key: 'mo-lead',
      freq: 'MONTHLY',
      monthDay: 1,
      dueTime: '10:00',
      leadDays: 3,
    });
    await setMark(sinLead, '2026-01-29');
    await setMark(conLead, '2026-01-29');
    await materializeRoutinesForTenant(R.tenantId, new Date('2026-01-30T12:00:00Z'));
    expect((await tasksOf(sinLead)).length).toBe(0);
    const rows = await tasksOf(conLead);
    expect(rows.length).toBe(1);
    expect(rows[0]!.due_at.toISOString()).toBe('2026-02-01T09:00:00.000Z');
  });

  it('QUARTERLY cae cada 3 meses desde el ancla', async () => {
    const id = await makeTemplate(R.tenantId, {
      key: 'qt',
      freq: 'QUARTERLY',
      monthDay: 5,
      dueTime: '11:00',
    });
    await setMark(id, '2026-04-04');
    await materializeRoutinesForTenant(R.tenantId, new Date('2026-04-05T12:00:00Z'));
    const rows = await tasksOf(id);
    expect(rows.length).toBe(1);
    expect(rows[0]!.due_at.toISOString()).toBe('2026-04-05T09:00:00.000Z');

    // Un mes que no es múltiplo de 3 desde el ancla (2025-01) no debe generar nada.
    await setMark(id, '2026-05-04');
    await materializeRoutinesForTenant(R.tenantId, new Date('2026-05-05T12:00:00Z'));
    expect((await tasksOf(id)).length).toBe(1);
  });

  it('YEARLY con lead_days genera la tarea con un mes de antelación', async () => {
    const id = await makeTemplate(R.tenantId, {
      key: 'yr',
      freq: 'YEARLY',
      month: 1,
      monthDay: 15,
      dueTime: '10:00',
      leadDays: 30,
    });
    await setMark(id, '2025-12-19');
    await materializeRoutinesForTenant(R.tenantId, new Date('2025-12-20T12:00:00Z'));
    const rows = await tasksOf(id);
    expect(rows.length).toBe(1);
    expect(rows[0]!.due_at.toISOString()).toBe('2026-01-15T09:00:00.000Z');
  });

  it('enabled=false no materializa nada', async () => {
    const id = await makeTemplate(R.tenantId, {
      key: 'off',
      freq: 'WEEKDAYS',
      dueTime: '08:00',
      enabled: false,
    });
    await setMark(id, '2026-01-14');
    await materializeRoutinesForTenant(R.tenantId, new Date('2026-01-15T12:00:00Z'));
    expect((await tasksOf(id)).length).toBe(0);
    // y la marca sigue sin avanzar
    const [t] = await raw<{ last_materialized_on: string }[]>`
      select last_materialized_on::text from task_templates where id = ${id}`;
    expect(t!.last_materialized_on).toBe('2026-01-14');
  });

  it('la tarea generada hereda checklist, evidencia, rol y asignado por defecto', async () => {
    const [tpl] = await raw<{ id: string }[]>`
      insert into task_templates
        (tenant_id, key, name, description, category, priority, recurrence_freq,
         recurrence_weekdays, due_time, requires_evidence, default_role,
         default_assignee_user_id, created_at)
      values (${R.tenantId}, 'herencia', 'Cierre QA', 'desc QA', 'CLINICAL', 'HIGH',
         'WEEKDAYS', '{}'::int[], '20:00', true, 'recepción', ${R.userB}, ${ANCHOR}::timestamptz)
      returning id`;
    await raw`insert into task_template_items (tenant_id, template_id, content, "order")
      values (${R.tenantId}, ${tpl!.id}, 'paso 1', 0), (${R.tenantId}, ${tpl!.id}, 'paso 2', 1)`;
    await setMark(tpl!.id, '2026-01-14');
    await materializeRoutinesForTenant(R.tenantId, new Date('2026-01-15T12:00:00Z'));

    const [task] = await raw<Record<string, unknown>[]>`
      select * from tasks where template_id = ${tpl!.id}`;
    expect(task!.title).toBe('Cierre QA');
    expect(task!.source).toBe('ROUTINE');
    expect(task!.requires_evidence).toBe(true);
    expect(task!.labels).toEqual(['recepción']);
    const { n: cl } = (
      await raw<{ n: number }[]>`
      select count(*)::int as n from task_checklist_items where task_id = ${task!.id as string}`
    )[0]!;
    expect(cl).toBe(2);
    const { n: asg } = (
      await raw<{ n: number }[]>`
      select count(*)::int as n from task_assignees where task_id = ${task!.id as string}`
    )[0]!;
    expect(asg).toBe(1);
    const [act] = await raw<{ body: string }[]>`
      select body from task_comments where task_id = ${task!.id as string} and kind='activity'`;
    expect(act!.body).toBe('Generada por la rutina "Cierre QA"');
  });
});

describe('5c. Auto-provisión: catálogo real materializado', () => {
  it('un miércoles solo salen las rutinas que tocan ese día', async () => {
    const T = await seedTenant('autoprov');
    await seedSystemTemplates(T.tenantId);
    // Ancla fija para que la recurrencia no dependa de la fecha real de hoy.
    await raw`update task_templates set created_at = ${ANCHOR}::timestamptz,
              last_materialized_on = '2026-09-01'::date where tenant_id = ${T.tenantId}`;

    const res = await materializeRoutinesForTenant(T.tenantId, new Date('2026-09-02T12:00:00Z'));
    expect(res.templates).toBe(16);
    const titulos = await raw<{ title: string; due_at: Date }[]>`
      select t.title, t.due_at from tasks t where t.tenant_id = ${T.tenantId} order by t.due_at`;
    expect(titulos.map((t) => t.title)).toEqual([
      'Apertura de clínica', // 08:30
      'Reunión de arranque (huddle)', // 09:00
      'Pedido de material y caducidades', // 16:00 (WEEKLY miércoles)
      'Cierre de clínica', // 20:00 — es el cierre quien lanza el ciclo…
      'Registro del ciclo de esterilización', // 20:30 — …y luego se registra
    ]);
    // Septiembre en Madrid = UTC+2
    expect(titulos[0]!.due_at.toISOString()).toBe('2026-09-02T06:30:00.000Z');
    expect(res.created).toBe(5);
  });
});
