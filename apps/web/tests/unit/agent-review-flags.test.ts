import { describe, expect, it } from 'vitest';

import { parseGuardrails, reviewRun } from '@/lib/agent-review/flags';

const base = {
  userText: 'Hola, quería cita',
  responseText: 'Claro, ¿para cuándo?',
  tools: [],
  errorText: null,
  intentReasoning: null,
  latencyMs: 2000,
  handoff: false,
  fallbackUsed: false,
};

describe('revisión automática de una respuesta del asistente', () => {
  it('una respuesta normal no tiene avisos', () => {
    expect(reviewRun(base)).toEqual({ level: 'ok', flags: [] });
  });

  it('error, sin respuesta y herramienta fallida son errores', () => {
    expect(reviewRun({ ...base, errorText: 'timeout' }).level).toBe('error');
    expect(reviewRun({ ...base, responseText: '' }).level).toBe('error');
    const r = reviewRun({ ...base, tools: [{ name: 'book_appointment', ok: false, error: 'x' }] });
    expect(r.level).toBe('error');
    expect(r.flags[0]?.code).toBe('tool_error:book_appointment');
  });

  it('una herramienta que no pudo es aviso con el motivo', () => {
    const r = reviewRun({
      ...base,
      tools: [{ name: 'register_patient', ok: true, result: 'NO registrado: falta el año' }],
    });
    expect(r.level).toBe('warn');
    expect(r.flags[0]).toMatchObject({ code: 'tool_refused:register_patient' });
    expect(r.flags[0]?.detail).toContain('falta el año');
  });

  it('pedir perdón, día cerrado y queja de la familia (los casos del 6/11)', () => {
    expect(
      reviewRun({
        ...base,
        responseText: 'Perdona, tienes razón, la cita quedó a las 18:30',
      }).flags.map((f) => f.code),
    ).toContain('apology');
    expect(
      reviewRun({
        ...base,
        responseText: 'El sábado 14 no me queda nada.',
        tools: [
          { name: 'check_availability', ok: true, result: 'La clínica NO ABRE los sábados…' },
        ],
      }).flags.map((f) => f.code),
    ).toContain('closed_day');
    expect(
      reviewRun({ ...base, userText: 'No es eso, te he dicho el viernes' }).flags[0]?.code,
    ).toBe('complaint');
  });

  it('lee los guardrails del intent_reasoning y los gradúa', () => {
    expect(parseGuardrails('guardrail: clinic_greeting; first_visit_forced')).toEqual([
      'clinic_greeting',
      'first_visit_forced',
    ]);
    expect(parseGuardrails(null)).toEqual([]);
    const r = reviewRun({
      ...base,
      intentReasoning: 'guardrail: clinic_greeting; birth_date_from_text',
    });
    expect(r.flags.map((f) => [f.code, f.level])).toEqual([
      ['guardrail:clinic_greeting', 'info'],
      ['guardrail:birth_date_from_text', 'warn'],
    ]);
    expect(r.level).toBe('warn');
  });

  it('lenta, larga, con demasiadas preguntas', () => {
    expect(reviewRun({ ...base, latencyMs: 25_000 }).flags[0]?.code).toBe('slow');
    expect(reviewRun({ ...base, responseText: 'x'.repeat(1000) }).flags[0]?.code).toBe('long');
    expect(reviewRun({ ...base, responseText: '¿A? ¿B? ¿C?' }).flags[0]?.code).toBe(
      'many_questions',
    );
  });
});
