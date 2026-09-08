import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { describeAbsences, describeWeeklySchedule } from '@/lib/agenda/describe';
import { reconciliar } from '@/scripts/retell/sync-agenda-tools';

const TZ = 'Europe/Madrid';

describe('horario contado con palabras', () => {
  it('agrupa los días seguidos que coinciden', () => {
    const shifts = [1, 2, 3, 4, 5].flatMap((weekday) => [
      { weekday, startMinute: 9 * 60, endMinute: 14 * 60 },
      { weekday, startMinute: 16 * 60, endMinute: 20 * 60 },
    ]);
    expect(describeWeeklySchedule(shifts)).toBe(
      'lunes a viernes de 09:00 a 14:00 y de 16:00 a 20:00',
    );
  });

  it('separa los días que no coinciden', () => {
    const shifts = [
      { weekday: 1, startMinute: 9 * 60, endMinute: 14 * 60 },
      { weekday: 2, startMinute: 9 * 60, endMinute: 14 * 60 },
      { weekday: 6, startMinute: 10 * 60, endMinute: 13 * 60 },
    ];
    expect(describeWeeklySchedule(shifts)).toBe(
      'lunes a martes de 09:00 a 14:00; sábado de 10:00 a 13:00',
    );
  });

  it('no junta días salteados aunque tengan el mismo horario', () => {
    // Lunes y miércoles con el mismo horario NO son "lunes a miércoles": el
    // martes no trabaja y decirlo así sería mentir al paciente.
    const shifts = [
      { weekday: 1, startMinute: 9 * 60, endMinute: 14 * 60 },
      { weekday: 3, startMinute: 9 * 60, endMinute: 14 * 60 },
    ];
    expect(describeWeeklySchedule(shifts)).toBe(
      'lunes de 09:00 a 14:00; miércoles de 09:00 a 14:00',
    );
  });

  it('sin franjas lo dice en vez de callarse', () => {
    expect(describeWeeklySchedule([])).toBe('sin horario cargado');
  });
});

describe('ausencias contadas con palabras', () => {
  const ahora = new Date('2026-09-08T10:00:00Z');

  it('cuenta un rango de días completo', () => {
    const texto = describeAbsences(
      [
        {
          startsAt: new Date('2026-09-13T22:00:00Z'), // 14 de septiembre en Madrid
          endsAt: new Date('2026-09-18T22:00:00Z'), // hasta el 18 incluido
          allDay: true,
          reason: 'Vacaciones',
        },
      ],
      TZ,
      ahora,
    );
    expect(texto).toBe('del 14 de septiembre al 18 de septiembre');
  });

  it('un rato suelto se cuenta con horas', () => {
    const texto = describeAbsences(
      [
        {
          startsAt: new Date('2026-09-10T08:00:00Z'), // 10:00 en Madrid
          endsAt: new Date('2026-09-10T12:00:00Z'), // 14:00
          allDay: false,
          reason: 'Formación',
        },
      ],
      TZ,
      ahora,
    );
    expect(texto).toBe('el 10 de septiembre de 10:00 a 14:00');
  });

  it('no dice el motivo: es asunto del profesional, no del paciente', () => {
    const texto = describeAbsences(
      [
        {
          startsAt: new Date('2026-09-20T22:00:00Z'),
          endsAt: new Date('2026-09-21T22:00:00Z'),
          allDay: true,
          reason: 'Baja médica',
        },
      ],
      TZ,
      ahora,
    );
    expect(texto).not.toMatch(/baja/i);
  });

  it('ignora lo que ya pasó y lo que queda muy lejos', () => {
    const texto = describeAbsences(
      [
        {
          startsAt: new Date('2026-08-01T00:00:00Z'),
          endsAt: new Date('2026-08-10T00:00:00Z'),
          allDay: true,
          reason: null,
        },
        {
          startsAt: new Date('2027-01-01T00:00:00Z'),
          endsAt: new Date('2027-01-10T00:00:00Z'),
          allDay: true,
          reason: null,
        },
      ],
      TZ,
      ahora,
    );
    expect(texto).toBe('');
  });
});

describe('sincronización de tools de Retell', () => {
  it('añade list_professionals y los campos nuevos de las tools existentes', () => {
    const { tools, faltaba } = reconciliar([
      {
        name: 'check_availability',
        type: 'custom',
        parameters: {
          type: 'object',
          properties: { treatment_name: { type: 'string' }, preferred_date: { type: 'string' } },
          required: ['treatment_name', 'preferred_date'],
        },
      },
      {
        name: 'book_appointment',
        type: 'custom',
        parameters: {
          type: 'object',
          properties: { start_time: { type: 'string' }, treatment_name: { type: 'string' } },
          required: ['start_time', 'treatment_name'],
        },
      },
    ]);

    expect(faltaba).toContain('list_professionals');
    expect(faltaba).toContain('check_availability.professional_name');
    expect(faltaba).toContain('book_appointment.professional_id');
    expect(tools.map((t) => t.name)).toContain('list_professionals');
    expect(
      tools.find((t) => t.name === 'check_availability')?.parameters?.properties,
    ).toHaveProperty('professional_name');
  });

  it('es idempotente: pasar dos veces no cambia nada', () => {
    const primera = reconciliar([]);
    const segunda = reconciliar(primera.tools);
    expect(segunda.faltaba).toEqual([]);
    expect(segunda.tools).toHaveLength(primera.tools.length);
  });

  it('no le inventa esquema a una tool que no acepta argumentos', () => {
    const { tools, faltaba } = reconciliar([{ name: 'book_appointment', type: 'custom' }]);
    expect(faltaba).not.toContain('book_appointment.professional_id');
    expect(tools.find((t) => t.name === 'book_appointment')?.parameters).toBeUndefined();
  });
});
