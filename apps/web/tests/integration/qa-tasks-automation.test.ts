import { beforeAll, describe, expect, it } from 'vitest';

import {
  AUTOMATION_DEFAULTS,
  ensureAutomationRules,
  renderTemplate,
  runTaskAutomation,
} from '@/lib/tasks/automation';
import {
  onAppointmentCancelled,
  onAppointmentCompleted,
  onAppointmentNoShow,
  onCallProcessed,
  onReminderNoResponse,
  onWaitlistAcceptedUnscheduled,
  onWhatsappHandoff,
} from '@/lib/tasks/hooks';
import { runDailySweepsForTenant } from '@/lib/tasks/materialize';
import { loadAutomationRules } from '@/lib/tasks/queries';
import { type SeedIds, raw, seedTenant } from './_qa-tasks-helpers';

const RUN = Math.random().toString(36).slice(2, 8);

let A: SeedIds; // hooks
let W: SeedIds; // barridos

async function autoTask(tenantId: string, trigger: string): Promise<Record<string, unknown>[]> {
  return raw<Record<string, unknown>[]>`
    select * from tasks
    where tenant_id = ${tenantId} and automation_trigger = ${trigger}::task_automation_trigger
    order by created_at`;
}

function defaultsFor(trigger: string) {
  return AUTOMATION_DEFAULTS.find((d) => d.trigger === trigger)!;
}

/** El SLA se calcula con Date.now(): comprobamos la ventana, no el instante exacto. */
function expectSla(dueAt: Date, offsetMinutes: number): void {
  const delta = dueAt.getTime() - Date.now() - offsetMinutes * 60_000;
  expect(Math.abs(delta)).toBeLessThan(120_000);
}

beforeAll(async () => {
  A = await seedTenant('hooks');
  W = await seedTenant('sweeps');
  await ensureAutomationRules(A.tenantId);
  await ensureAutomationRules(W.tenantId);
  // Paciente base del tenant de hooks.
  await raw`
    insert into patients_cache (tenant_id, ghl_contact_id, first_name, last_name, phone, last_visit_at)
    values (${A.tenantId}, 'ghl-marta', 'Marta', 'López', '+34600111222', now() - interval '10 days')`;
});

describe('6a. ensureAutomationRules', () => {
  it('crea las 10 reglas del catálogo y es idempotente', async () => {
    expect(AUTOMATION_DEFAULTS.length).toBe(10);
    await ensureAutomationRules(A.tenantId); // segunda pasada
    const { n } = (
      await raw<{ n: number }[]>`
      select count(*)::int as n from task_automation_rules where tenant_id = ${A.tenantId}`
    )[0]!;
    expect(n).toBe(10);
    const rules = await loadAutomationRules(A.tenantId);
    expect(rules.length).toBe(10);
    expect(rules.every((r) => r.enabled)).toBe(true);
  });

  it('renderTemplate sustituye variables y cae a los textos por defecto', () => {
    expect(
      renderTemplate('{{patientName}} · {{phone}} · {{date}} · {{treatment}}', {
        patientName: 'Marta López',
        phone: '+34600111222',
        date: '10 de enero de 2026',
        treatment: 'Implante',
        dedupeSuffix: 'x',
      }),
    ).toBe('Marta López · +34600111222 · 10 de enero de 2026 · Implante');
    expect(renderTemplate('{{patientName}} {{phone}}', { dedupeSuffix: 'x' })).toBe(
      'un paciente sin teléfono',
    );
  });
});

describe('6b. Los 10 hooks', () => {
  it('1) MISSED_CALL — llamada corta o con error', async () => {
    const [call] = await raw<{ id: string }[]>`
      insert into calls (tenant_id, retell_call_id, from_number, to_number, ghl_contact_id,
                         started_at, duration_seconds, status)
      values (${A.tenantId}, ${`retell-missed-1-${RUN}`}, '+34600111222', '+34900000000', 'ghl-marta',
              '2026-01-10T09:00:00Z', 5, 'ended')
      returning id`;
    await onCallProcessed({ tenantId: A.tenantId, retellCallId: `retell-missed-1-${RUN}` });
    const rows = await autoTask(A.tenantId, 'MISSED_CALL');
    expect(rows.length).toBe(1);
    const t = rows[0]!;
    expect(t.title).toBe('Devolver llamada a Marta López');
    expect(t.description).toContain('+34600111222');
    expect(t.priority).toBe('URGENT');
    expect(t.category).toBe('PATIENT');
    expect(t.source).toBe('AUTOMATION');
    expect(t.call_id).toBe(call!.id);
    expect(t.patient_ghl_contact_id).toBe('ghl-marta');
    expect(t.dedupe_key).toBe(`auto:MISSED_CALL:${call!.id}`);
    expectSla(t.due_at as Date, defaultsFor('MISSED_CALL').dueOffsetMinutes);

    // segundo disparo → dedupe
    await onCallProcessed({ tenantId: A.tenantId, retellCallId: `retell-missed-1-${RUN}` });
    expect((await autoTask(A.tenantId, 'MISSED_CALL')).length).toBe(1);
  });

  it('2) CALL_INTENT_UNRESOLVED — quería cita y no quedó agendada', async () => {
    await raw`
      insert into calls (tenant_id, retell_call_id, from_number, to_number, ghl_contact_id,
                         started_at, duration_seconds, status, intent)
      values (${A.tenantId}, ${`retell-intent-1-${RUN}`}, '+34600111222', '+34900000000', 'ghl-marta',
              '2026-01-10T10:00:00Z', 90, 'ended', 'agendar')`;
    await onCallProcessed({ tenantId: A.tenantId, retellCallId: `retell-intent-1-${RUN}` });
    const rows = await autoTask(A.tenantId, 'CALL_INTENT_UNRESOLVED');
    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toBe('Cerrar la cita de Marta López');
    expect(rows[0]!.priority).toBe('URGENT');
    expectSla(rows[0]!.due_at as Date, defaultsFor('CALL_INTENT_UNRESOLVED').dueOffsetMinutes);
    await onCallProcessed({ tenantId: A.tenantId, retellCallId: `retell-intent-1-${RUN}` });
    expect((await autoTask(A.tenantId, 'CALL_INTENT_UNRESOLVED')).length).toBe(1);
  });

  it('2b) con cita futura NO crea CALL_INTENT_UNRESOLVED', async () => {
    await raw`
      insert into patients_cache (tenant_id, ghl_contact_id, first_name, last_name, phone)
      values (${A.tenantId}, 'ghl-conCita', 'Juan', 'Ruiz', '+34600333444')`;
    await raw`
      insert into appointments_cache (tenant_id, ghl_appointment_id, contact_id, start_time, status)
      values (${A.tenantId}, 'appt-futura', 'ghl-conCita', now() + interval '5 days', 'confirmed')`;
    await raw`
      insert into calls (tenant_id, retell_call_id, from_number, to_number, ghl_contact_id,
                         started_at, duration_seconds, status, intent)
      values (${A.tenantId}, ${`retell-intent-2-${RUN}`}, '+34600333444', '+34900000000', 'ghl-conCita',
              '2026-01-10T11:00:00Z', 90, 'ended', 'agendar')`;
    await onCallProcessed({ tenantId: A.tenantId, retellCallId: `retell-intent-2-${RUN}` });
    expect((await autoTask(A.tenantId, 'CALL_INTENT_UNRESOLVED')).length).toBe(1);
  });

  it('3) APPOINTMENT_CANCELLED', async () => {
    await onAppointmentCancelled({
      tenantId: A.tenantId,
      ghlAppointmentId: 'appt-cancel-1',
      ghlContactId: 'ghl-marta',
      startTime: new Date('2026-01-20T09:00:00Z'),
    });
    const rows = await autoTask(A.tenantId, 'APPOINTMENT_CANCELLED');
    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toBe('Dar nueva cita a Marta López');
    expect(rows[0]!.priority).toBe('HIGH');
    expect(rows[0]!.ghl_appointment_id).toBe('appt-cancel-1');
    expect(rows[0]!.description).toContain('20 de enero'); // fecha renderizada en es-ES
    expectSla(rows[0]!.due_at as Date, defaultsFor('APPOINTMENT_CANCELLED').dueOffsetMinutes);
    await onAppointmentCancelled({
      tenantId: A.tenantId,
      ghlAppointmentId: 'appt-cancel-1',
      ghlContactId: 'ghl-marta',
      startTime: new Date('2026-01-20T09:00:00Z'),
    });
    expect((await autoTask(A.tenantId, 'APPOINTMENT_CANCELLED')).length).toBe(1);
  });

  it('4) APPOINTMENT_NO_SHOW — exige evidencia', async () => {
    await onAppointmentNoShow({
      tenantId: A.tenantId,
      ghlAppointmentId: 'appt-noshow-1',
      ghlContactId: 'ghl-marta',
      startTime: new Date('2026-01-21T09:00:00Z'),
    });
    const rows = await autoTask(A.tenantId, 'APPOINTMENT_NO_SHOW');
    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toBe('No se presentó: Marta López');
    expect(rows[0]!.requires_evidence).toBe(true);
    expectSla(rows[0]!.due_at as Date, defaultsFor('APPOINTMENT_NO_SHOW').dueOffsetMinutes);
  });

  it('5) REMINDER_NO_RESPONSE', async () => {
    const [rs] = await raw<{ id: string }[]>`
      insert into reminder_rule_sets (tenant_id, scope) values (${A.tenantId}, 'GLOBAL') returning id`;
    const [rr] = await raw<{ id: string }[]>`
      insert into reminder_rules (tenant_id, rule_set_id, offset_minutes, primary_channel)
      values (${A.tenantId}, ${rs!.id}, 1440, 'WHATSAPP') returning id`;
    await raw`
      insert into appointments_cache (tenant_id, ghl_appointment_id, contact_id, start_time, status)
      values (${A.tenantId}, 'appt-rem-1', 'ghl-marta', '2026-02-03T10:00:00Z', 'confirmed')`;
    const [rem] = await raw<{ id: string }[]>`
      insert into appointment_reminders
        (tenant_id, ghl_appointment_id, rule_id, rule_set_id, scheduled_for, channel_planned, payload_snapshot)
      values (${A.tenantId}, 'appt-rem-1', ${rr!.id}, ${rs!.id}, '2026-02-02T10:00:00Z', 'WHATSAPP',
              ${JSON.stringify({ vars: { contact: { phone: '+34600111222' } } })}::jsonb)
      returning id`;

    await onReminderNoResponse({ tenantId: A.tenantId, reminderId: rem!.id });
    const rows = await autoTask(A.tenantId, 'REMINDER_NO_RESPONSE');
    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toBe('Confirmar por teléfono a Marta López');
    expect(rows[0]!.reminder_id).toBe(rem!.id);
    expect(rows[0]!.ghl_appointment_id).toBe('appt-rem-1');
    expect(rows[0]!.description).toContain('03 de febrero');
    expectSla(rows[0]!.due_at as Date, defaultsFor('REMINDER_NO_RESPONSE').dueOffsetMinutes);
    await onReminderNoResponse({ tenantId: A.tenantId, reminderId: rem!.id });
    expect((await autoTask(A.tenantId, 'REMINDER_NO_RESPONSE')).length).toBe(1);
  });

  it('6) POST_TREATMENT_FOLLOWUP — solo si el tratamiento lo pide', async () => {
    const [sin] = await raw<{ id: string }[]>`
      insert into treatments (tenant_id, name, duration_minutes, post_op_follow_up)
      values (${A.tenantId}, 'Limpieza', 30, false) returning id`;
    const [con] = await raw<{ id: string }[]>`
      insert into treatments (tenant_id, name, duration_minutes, post_op_follow_up)
      values (${A.tenantId}, 'Extracción', 45, true) returning id`;

    await onAppointmentCompleted({
      tenantId: A.tenantId,
      ghlAppointmentId: 'appt-done-limpieza',
      ghlContactId: 'ghl-marta',
      startTime: new Date('2026-01-22T09:00:00Z'),
      treatmentId: sin!.id,
    });
    expect((await autoTask(A.tenantId, 'POST_TREATMENT_FOLLOWUP')).length).toBe(0);

    await onAppointmentCompleted({
      tenantId: A.tenantId,
      ghlAppointmentId: 'appt-done-extraccion',
      ghlContactId: 'ghl-marta',
      startTime: new Date('2026-01-22T09:00:00Z'),
      treatmentId: con!.id,
    });
    const rows = await autoTask(A.tenantId, 'POST_TREATMENT_FOLLOWUP');
    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toBe('Llamada postoperatoria a Marta López');
    expect(rows[0]!.description).toContain('Extracción');
    expect(rows[0]!.requires_evidence).toBe(true);
    expectSla(rows[0]!.due_at as Date, defaultsFor('POST_TREATMENT_FOLLOWUP').dueOffsetMinutes);
  });

  it('7) WHATSAPP_HANDOFF — una tarea por conversación y día', async () => {
    const [c] = await raw<{ id: string }[]>`
      insert into whatsapp_contacts (tenant_id, phone_e164, name, ghl_contact_id)
      values (${A.tenantId}, '+34600555666', 'Lucía Gómez', 'ghl-lucia') returning id`;
    const [conv] = await raw<{ id: string }[]>`
      insert into whatsapp_conversations (tenant_id, contact_id, channel)
      values (${A.tenantId}, ${c!.id}, 'WHATSAPP_CLOUD') returning id`;
    await onWhatsappHandoff({ tenantId: A.tenantId, conversationId: conv!.id });
    const rows = await autoTask(A.tenantId, 'WHATSAPP_HANDOFF');
    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toBe('Responder el WhatsApp de Lucía Gómez');
    expect(rows[0]!.whatsapp_conversation_id).toBe(conv!.id);
    expect(rows[0]!.priority).toBe('URGENT');
    expect(rows[0]!.dedupe_key).toBe(
      `auto:WHATSAPP_HANDOFF:${conv!.id}:${new Date().toISOString().slice(0, 10)}`,
    );
    expectSla(rows[0]!.due_at as Date, defaultsFor('WHATSAPP_HANDOFF').dueOffsetMinutes);
    await onWhatsappHandoff({ tenantId: A.tenantId, conversationId: conv!.id });
    expect((await autoTask(A.tenantId, 'WHATSAPP_HANDOFF')).length).toBe(1);
  });

  it('8) WAITLIST_ACCEPTED_UNSCHEDULED', async () => {
    const entryId = '11111111-2222-3333-4444-555555555555';
    await onWaitlistAcceptedUnscheduled({
      tenantId: A.tenantId,
      entryId,
      ghlContactId: 'ghl-marta',
      slotStart: new Date('2026-01-25T15:00:00Z'),
    });
    const rows = await autoTask(A.tenantId, 'WAITLIST_ACCEPTED_UNSCHEDULED');
    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toBe('Agendar el hueco que aceptó Marta López');
    expect(rows[0]!.waitlist_entry_id).toBe(entryId);
    expectSla(
      rows[0]!.due_at as Date,
      defaultsFor('WAITLIST_ACCEPTED_UNSCHEDULED').dueOffsetMinutes,
    );
    await onWaitlistAcceptedUnscheduled({
      tenantId: A.tenantId,
      entryId,
      ghlContactId: 'ghl-marta',
      slotStart: new Date('2026-01-25T15:00:00Z'),
    });
    expect((await autoTask(A.tenantId, 'WAITLIST_ACCEPTED_UNSCHEDULED')).length).toBe(1);
  });

  it('9-10) PENDING_TREATMENT_UNSCHEDULED y PATIENT_INACTIVE por barrido', async () => {
    await raw`
      insert into patients_cache (tenant_id, ghl_contact_id, first_name, last_name, phone,
                                  pending_treatment, last_visit_at)
      values (${A.tenantId}, 'ghl-presu', 'Pedro', 'Sanz', '+34600777888',
              'Ortodoncia invisible', now() - interval '20 days')`;
    await raw`
      insert into patients_cache (tenant_id, ghl_contact_id, first_name, last_name, phone, last_visit_at)
      values (${A.tenantId}, 'ghl-dormido', 'Rosa', 'Vidal', '+34600999000', now() - interval '3 years')`;
    await runDailySweepsForTenant(A.tenantId, new Date());

    const pend = await autoTask(A.tenantId, 'PENDING_TREATMENT_UNSCHEDULED');
    expect(pend.length).toBe(1);
    expect(pend[0]!.title).toBe('Perseguir presupuesto de Pedro Sanz');
    expect(pend[0]!.description).toContain('Ortodoncia invisible');
    expectSla(
      pend[0]!.due_at as Date,
      defaultsFor('PENDING_TREATMENT_UNSCHEDULED').dueOffsetMinutes,
    );

    const inact = await autoTask(A.tenantId, 'PATIENT_INACTIVE');
    expect(inact.length).toBe(1);
    expect(inact[0]!.title).toBe('Reactivar a Rosa Vidal');
    expect(inact[0]!.category).toBe('MARKETING');
    expectSla(inact[0]!.due_at as Date, defaultsFor('PATIENT_INACTIVE').dueOffsetMinutes);
  });

  it('una regla con enabled=false no crea nada', async () => {
    const off = await seedTenant('rules-off');
    await ensureAutomationRules(off.tenantId);
    await raw`
      update task_automation_rules set enabled = false
      where tenant_id = ${off.tenantId} and trigger = 'APPOINTMENT_CANCELLED'`;
    const res = await runTaskAutomation({
      tenantId: off.tenantId,
      trigger: 'APPOINTMENT_CANCELLED',
      context: { dedupeSuffix: 'x' },
    });
    expect(res).toEqual({ created: false, reason: 'disabled' });
    expect((await autoTask(off.tenantId, 'APPOINTMENT_CANCELLED')).length).toBe(0);
  });

  it('sin reglas sembradas devuelve no_rule', async () => {
    const bare = await seedTenant('rules-none');
    const res = await runTaskAutomation({
      tenantId: bare.tenantId,
      trigger: 'MISSED_CALL',
      context: { dedupeSuffix: 'x' },
    });
    expect(res).toEqual({ created: false, reason: 'no_rule' });
  });
});

describe('7. Barridos diarios', () => {
  beforeAll(async () => {
    // P1: presupuesto pendiente, SIN cita futura → debe generar tarea
    await raw`
      insert into patients_cache (tenant_id, ghl_contact_id, first_name, last_name, phone,
                                  pending_treatment, last_visit_at)
      values (${W.tenantId}, 'p1', 'Ana', 'Uno', '+34611111111', 'Implante', now() - interval '10 days')`;
    // P2: presupuesto pendiente CON cita futura → excluido
    await raw`
      insert into patients_cache (tenant_id, ghl_contact_id, first_name, last_name, phone,
                                  pending_treatment, last_visit_at)
      values (${W.tenantId}, 'p2', 'Beto', 'Dos', '+34622222222', 'Corona', now() - interval '10 days')`;
    await raw`
      insert into appointments_cache (tenant_id, ghl_appointment_id, contact_id, start_time)
      values (${W.tenantId}, 'a-p2', 'p2', now() + interval '10 days')`;
    // P3: inactivo hace 3 años, sin cita futura → debe generar tarea
    await raw`
      insert into patients_cache (tenant_id, ghl_contact_id, first_name, last_name, phone, last_visit_at)
      values (${W.tenantId}, 'p3', 'Ceci', 'Tres', '+34633333333', now() - interval '3 years')`;
    // P4: inactivo hace 3 años PERO con cita futura → excluido
    await raw`
      insert into patients_cache (tenant_id, ghl_contact_id, first_name, last_name, phone, last_visit_at)
      values (${W.tenantId}, 'p4', 'Dani', 'Cuatro', '+34644444444', now() - interval '3 years')`;
    await raw`
      insert into appointments_cache (tenant_id, ghl_appointment_id, contact_id, start_time)
      values (${W.tenantId}, 'a-p4', 'p4', now() + interval '10 days')`;
    // P5: última visita hace 6 meses → dentro de los 12 meses por defecto, no aplica
    await raw`
      insert into patients_cache (tenant_id, ghl_contact_id, first_name, last_name, phone, last_visit_at)
      values (${W.tenantId}, 'p5', 'Eva', 'Cinco', '+34655555555', now() - interval '6 months')`;
  });

  it('excluye a quien tiene cita futura y cuenta lo esperado', async () => {
    const r = await runDailySweepsForTenant(W.tenantId, new Date());
    expect(r).toEqual({ pendingTreatment: 1, inactive: 1 });
    const pend = await autoTask(W.tenantId, 'PENDING_TREATMENT_UNSCHEDULED');
    expect(pend.map((t) => t.patient_ghl_contact_id)).toEqual(['p1']);
    const inact = await autoTask(W.tenantId, 'PATIENT_INACTIVE');
    expect(inact.map((t) => t.patient_ghl_contact_id)).toEqual(['p3']);
  });

  it('el dedupe es mensual: dos corridas el mismo día = una sola tarea', async () => {
    const r2 = await runDailySweepsForTenant(W.tenantId, new Date());
    expect(r2).toEqual({ pendingTreatment: 0, inactive: 0 });
    expect((await autoTask(W.tenantId, 'PENDING_TREATMENT_UNSCHEDULED')).length).toBe(1);
    expect((await autoTask(W.tenantId, 'PATIENT_INACTIVE')).length).toBe(1);

    const now = new Date();
    const mes = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const [t] = await autoTask(W.tenantId, 'PENDING_TREATMENT_UNSCHEDULED');
    expect(t!.dedupe_key).toBe(`auto:PENDING_TREATMENT_UNSCHEDULED:p1:${mes}`);
  });

  it('al mes siguiente vuelve a crear la tarea', async () => {
    const next = new Date();
    next.setUTCMonth(next.getUTCMonth() + 1);
    next.setUTCDate(10);
    const r = await runDailySweepsForTenant(W.tenantId, next);
    // p1 vuelve por dedupe mensual; p2 entra porque su cita ya quedó en el pasado.
    expect(r.pendingTreatment).toBe(2);
    const pend = await autoTask(W.tenantId, 'PENDING_TREATMENT_UNSCHEDULED');
    expect(pend.length).toBe(3);
    expect(new Set(pend.map((t) => t.patient_ghl_contact_id))).toEqual(new Set(['p1', 'p2']));
  });

  it('inactiveMonths de params manda sobre el default de 12', async () => {
    const X = await seedTenant('inactive-param');
    await ensureAutomationRules(X.tenantId);
    await raw`
      update task_automation_rules set params = '{"inactiveMonths": 3}'::jsonb
      where tenant_id = ${X.tenantId} and trigger = 'PATIENT_INACTIVE'`;
    await raw`
      insert into patients_cache (tenant_id, ghl_contact_id, first_name, last_name, last_visit_at)
      values (${X.tenantId}, 'q1', 'Seis', 'Meses', now() - interval '6 months')`;
    const r = await runDailySweepsForTenant(X.tenantId, new Date());
    expect(r.inactive).toBe(1);
  });
});
