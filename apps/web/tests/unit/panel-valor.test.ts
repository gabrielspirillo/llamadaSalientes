import { describe, expect, it } from 'vitest';

import {
  estimateSavings,
  outOfTen,
  summarizeRecovered,
  workdaysLabel,
} from '@/lib/data/analytics/value-model';

describe('panel: horas ahorradas', () => {
  it('suma los minutos de cada cosa que hizo la plataforma sola', () => {
    const s = estimateSavings({ reply: 100, booking: 10, reminder: 20, offer: 5 });
    expect(s.totalMinutes).toBe(150 + 30 + 40 + 15);
    expect(s.parts.map((p) => p.key)).toEqual(['reply', 'booking', 'reminder', 'offer']);
    expect(s.parts[0]?.label).toBe('Respondiendo WhatsApp');
  });

  it('sin actividad, cero (y nada negativo)', () => {
    expect(estimateSavings({ reply: 0, booking: -3, reminder: 0, offer: 0 }).totalMinutes).toBe(0);
  });

  it('jornadas de recepción', () => {
    expect(workdaysLabel(100)).toBe('');
    expect(workdaysLabel(480)).toBe('≈ 1 jornada de recepción');
    expect(workdaysLabel(30 * 60)).toBe('≈ 4 jornadas de recepción');
    expect(workdaysLabel(4.6 * 480)).toBe('≈ 4,5 jornadas de recepción');
  });
});

describe('panel: dinero recuperado', () => {
  const weekStarts = [
    new Date('2026-10-26T00:00:00Z'),
    new Date('2026-11-02T00:00:00Z'),
    new Date('2026-11-09T00:00:00Z'),
  ];
  const opts = { fallbackCents: 4000, monthStart: new Date('2026-11-01T00:00:00Z'), weekStarts };

  it('suma por mes, por semana y en total; sin precio vale el precio medio', () => {
    const r = summarizeRecovered(
      [
        { answeredAt: new Date('2026-10-20T10:00:00Z'), cents: 4500 },
        { answeredAt: new Date('2026-10-30T10:00:00Z'), cents: null },
        { answeredAt: new Date('2026-11-03T10:00:00Z'), cents: 4500 },
        { answeredAt: new Date('2026-11-12T10:00:00Z'), cents: 0 },
      ],
      opts,
    );
    expect(r.totalCents).toBe(4500 + 4000 + 4500 + 4000);
    expect(r.totalCount).toBe(4);
    expect(r.monthCents).toBe(8500);
    expect(r.monthCount).toBe(2);
    // La del 20/10 cae antes de la primera semana: no está en las barras.
    expect(r.weekly).toEqual([4000, 4500, 4000]);
  });

  it('sin ofertas aceptadas, todo a cero', () => {
    const r = summarizeRecovered([], opts);
    expect(r).toEqual({
      monthCents: 0,
      monthCount: 0,
      totalCents: 0,
      totalCount: 0,
      weekly: [0, 0, 0],
    });
  });
});

describe('panel: citas del asistente de cada 10', () => {
  it('redondea y nunca deja a cero si dio alguna', () => {
    expect(outOfTen(103, 315)).toBe(3);
    expect(outOfTen(1, 300)).toBe(1);
    expect(outOfTen(0, 300)).toBe(0);
    expect(outOfTen(5, 0)).toBe(0);
    expect(outOfTen(20, 10)).toBe(10);
  });
});
