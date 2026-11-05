import { describe, expect, it } from 'vitest';

import { parseAdvanceReply } from '@/lib/agenda/advance-offers';

describe('respuesta a la oferta de adelanto', () => {
  it('lee el número o el sí/no de la familia', () => {
    expect(parseAdvanceReply('1')).toBe('yes');
    expect(parseAdvanceReply('Sí, por favor')).toBe('yes');
    expect(parseAdvanceReply('vale!')).toBe('yes');
    expect(parseAdvanceReply('2')).toBe('no');
    expect(parseAdvanceReply('No, mejor la dejamos')).toBe('no');
    expect(parseAdvanceReply('no gracias')).toBe('no');
  });

  it('deja pasar al asistente lo que no es una respuesta', () => {
    expect(parseAdvanceReply('¿A qué hora era?')).toBeNull();
    expect(parseAdvanceReply('')).toBeNull();
    expect(
      parseAdvanceReply('hola quería pedir cita para mi hijo mayor que tiene tos desde hace días'),
    ).toBeNull();
  });
});

describe('plazo para contestar la oferta', () => {
  it('dice los 45 minutos o, si el hueco está cerca, la hora límite', async () => {
    const { validityLine } = await import('@/lib/agenda/advance-offers');
    const now = new Date('2026-11-05T15:00:00Z');
    expect(validityLine(now, new Date(now.getTime() + 45 * 60_000), 'Europe/Madrid')).toBe(
      'Esta oferta es válida durante los próximos 45 minutos.',
    );
    expect(validityLine(now, new Date(now.getTime() + 20 * 60_000), 'Europe/Madrid')).toBe(
      'Esta oferta es válida hasta las 16:20.',
    );
  });
});
