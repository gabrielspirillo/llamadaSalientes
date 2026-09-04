import { beforeAll, describe, expect, it } from 'vitest';

import {
  ensureAutomationRules,
  evaluateConditions,
  runTaskAutomation,
} from '@/lib/tasks/automation';
import { loadAutomationRules } from '@/lib/tasks/queries';
import { type SeedIds, raw, seedTenant } from './_qa-tasks-helpers';

const RUN = Math.random().toString(36).slice(2, 8);

/** Inserta una regla a medida y devuelve su id. */
async function insertCustomRule(
  tenantId: string,
  over: {
    trigger: string;
    name: string;
    title?: string;
    conditions?: unknown[];
    checklist?: string[];
    enabled?: boolean;
  },
): Promise<string> {
  const [r] = await raw<{ id: string }[]>`
    insert into task_automation_rules
      (tenant_id, trigger, name, is_system, enabled, title_template, category, priority,
       due_offset_minutes, conditions, checklist)
    values (${tenantId}, ${over.trigger}::task_automation_trigger, ${over.name}, false,
            ${over.enabled ?? true}, ${over.title ?? 'Tarea a medida de {{patientName}}'},
            'PATIENT', 'HIGH', 60,
            ${JSON.stringify(over.conditions ?? [])}::jsonb,
            ${(over.checklist ?? []) as string[]})
    returning id`;
  return r!.id;
}

async function tasksWithPrefix(
  tenantId: string,
  prefix: string,
): Promise<Record<string, unknown>[]> {
  return raw<Record<string, unknown>[]>`
    select * from tasks
    where tenant_id = ${tenantId} and dedupe_key like ${`${prefix}%`}
    order by created_at`;
}

let S: SeedIds;
beforeAll(async () => {
  S = await seedTenant('builder');
  await ensureAutomationRules(S.tenantId);
});

describe('constructor: el catálogo queda marcado como sistema', () => {
  it('siembra 10 reglas, todas is_system con nombre', async () => {
    const rows = await raw<{ n: number; sys: number; named: number }[]>`
      select count(*)::int as n,
             count(*) filter (where is_system)::int as sys,
             count(*) filter (where name is not null)::int as named
      from task_automation_rules where tenant_id = ${S.tenantId}`;
    expect(rows[0]).toEqual({ n: 10, sys: 10, named: 10 });

    const rules = await loadAutomationRules(S.tenantId);
    expect(rules.every((r) => r.isSystem)).toBe(true);
    const missed = rules.find((r) => r.trigger === 'MISSED_CALL');
    expect(missed?.name).toBe('Llamada perdida');
  });

  it('un segundo ensure con una regla a medida presente sigue sin duplicar el catálogo', async () => {
    await insertCustomRule(S.tenantId, { trigger: 'MISSED_CALL', name: 'Extra' });
    await ensureAutomationRules(S.tenantId);
    const rows = await raw<{ sys: number }[]>`
      select count(*) filter (where is_system)::int as sys
      from task_automation_rules where tenant_id = ${S.tenantId}`;
    expect(rows[0]!.sys).toBe(10);
  });
});

describe('varias reglas sobre el mismo evento', () => {
  it('la de sistema y la de a medida disparan las dos, con dedupe distinto', async () => {
    const T = await seedTenant('multi');
    await ensureAutomationRules(T.tenantId);
    const customId = await insertCustomRule(T.tenantId, {
      trigger: 'MISSED_CALL',
      name: 'Devolver VIP',
      title: 'VIP: llamar a {{patientName}}',
      checklist: ['Saludar', 'Ofrecer hueco'],
    });

    const res = await runTaskAutomation({
      tenantId: T.tenantId,
      trigger: 'MISSED_CALL',
      context: { patientName: 'Ana', phone: '+34600000001', dedupeSuffix: `evt-${RUN}` },
    });
    expect(res.created).toBe(true);

    const sys = await tasksWithPrefix(T.tenantId, `auto:MISSED_CALL:evt-${RUN}`);
    const custom = await tasksWithPrefix(T.tenantId, `auto:MISSED_CALL:${customId}:evt-${RUN}`);
    expect(sys.length).toBe(1);
    expect(custom.length).toBe(1);
    expect(custom[0]!.title).toBe('VIP: llamar a Ana');

    // La tarea a medida hereda su checklist.
    const clRows = await raw<{ n: number }[]>`
      select count(*)::int as n from task_checklist_items where task_id = ${custom[0]!.id as string}`;
    expect(clRows[0]!.n).toBe(2);

    // Idempotente: mismo evento otra vez no duplica ninguna de las dos.
    await runTaskAutomation({
      tenantId: T.tenantId,
      trigger: 'MISSED_CALL',
      context: { patientName: 'Ana', phone: '+34600000001', dedupeSuffix: `evt-${RUN}` },
    });
    expect((await tasksWithPrefix(T.tenantId, `auto:MISSED_CALL:evt-${RUN}`)).length).toBe(1);
    expect(
      (await tasksWithPrefix(T.tenantId, `auto:MISSED_CALL:${customId}:evt-${RUN}`)).length,
    ).toBe(1);
  });
});

describe('condiciones', () => {
  it('la regla a medida solo dispara cuando el filtro se cumple', async () => {
    const T = await seedTenant('cond');
    await ensureAutomationRules(T.tenantId);
    const ruleId = await insertCustomRule(T.tenantId, {
      trigger: 'APPOINTMENT_CANCELLED',
      name: 'Solo García',
      conditions: [{ field: 'patientName', op: 'contains', value: 'garcia' }],
    });
    const prefix = `auto:APPOINTMENT_CANCELLED:${ruleId}:`;

    // Coincide (insensible a acentos y mayúsculas) → crea.
    await runTaskAutomation({
      tenantId: T.tenantId,
      trigger: 'APPOINTMENT_CANCELLED',
      context: { patientName: 'Lucía García', dedupeSuffix: `ok-${RUN}` },
    });
    expect((await tasksWithPrefix(T.tenantId, `${prefix}ok-${RUN}`)).length).toBe(1);

    // No coincide → no crea.
    await runTaskAutomation({
      tenantId: T.tenantId,
      trigger: 'APPOINTMENT_CANCELLED',
      context: { patientName: 'Pedro Ruiz', dedupeSuffix: `no-${RUN}` },
    });
    expect((await tasksWithPrefix(T.tenantId, `${prefix}no-${RUN}`)).length).toBe(0);
  });

  it('evaluateConditions cubre los operadores', () => {
    const ctx = {
      patientName: 'Álvaro Núñez',
      phone: '',
      treatment: 'Implante',
      dedupeSuffix: 'x',
    };
    expect(evaluateConditions([], ctx)).toBe(true);
    expect(
      evaluateConditions([{ field: 'patientName', op: 'contains', value: 'nunez' }], ctx),
    ).toBe(true);
    expect(
      evaluateConditions([{ field: 'patientName', op: 'not_contains', value: 'nunez' }], ctx),
    ).toBe(false);
    expect(evaluateConditions([{ field: 'phone', op: 'exists' }], ctx)).toBe(false);
    expect(evaluateConditions([{ field: 'phone', op: 'not_exists' }], ctx)).toBe(true);
    expect(evaluateConditions([{ field: 'treatment', op: 'equals', value: 'implante' }], ctx)).toBe(
      true,
    );
    // Todas deben cumplirse (Y): una falla → false.
    expect(
      evaluateConditions(
        [
          { field: 'treatment', op: 'equals', value: 'implante' },
          { field: 'phone', op: 'exists' },
        ],
        ctx,
      ),
    ).toBe(false);
  });
});

describe('reglas desactivadas y sin coincidencia', () => {
  it('si ninguna regla activa coincide, no crea y no rompe', async () => {
    const T = await seedTenant('nomatch');
    await ensureAutomationRules(T.tenantId);
    // Apaga la de sistema y deja solo una a medida con condición imposible.
    await raw`
      update task_automation_rules set enabled = false
      where tenant_id = ${T.tenantId} and trigger = 'WHATSAPP_HANDOFF' and is_system`;
    await insertCustomRule(T.tenantId, {
      trigger: 'WHATSAPP_HANDOFF',
      name: 'Imposible',
      conditions: [{ field: 'patientName', op: 'equals', value: '___nunca___' }],
    });
    const res = await runTaskAutomation({
      tenantId: T.tenantId,
      trigger: 'WHATSAPP_HANDOFF',
      context: { patientName: 'Cualquiera', dedupeSuffix: `x-${RUN}` },
    });
    expect(res).toEqual({ created: false, reason: 'no_match' });
  });
});
