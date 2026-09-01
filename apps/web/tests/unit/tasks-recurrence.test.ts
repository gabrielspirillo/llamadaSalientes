import { describe, expect, it } from 'vitest';

import { describeRecurrence, occursOn, pendingOccurrences } from '@/lib/tasks/recurrence';
import type { RecurrenceSpec } from '@/lib/tasks/recurrence';

function spec(partial: Partial<RecurrenceSpec>): RecurrenceSpec {
  return {
    freq: 'DAILY',
    interval: 1,
    weekdays: [],
    monthDay: null,
    month: null,
    anchorDateKey: '2026-09-01',
    ...partial,
  };
}

describe('occursOn', () => {
  it('DAILY con intervalo respeta el ancla', () => {
    const s = spec({ freq: 'DAILY', interval: 3 });
    expect(occursOn(s, '2026-09-01')).toBe(true);
    expect(occursOn(s, '2026-09-02')).toBe(false);
    expect(occursOn(s, '2026-09-04')).toBe(true);
  });

  it('WEEKDAYS excluye sábado y domingo', () => {
    const s = spec({ freq: 'WEEKDAYS' });
    expect(occursOn(s, '2026-09-04')).toBe(true); // viernes
    expect(occursOn(s, '2026-09-05')).toBe(false); // sábado
    expect(occursOn(s, '2026-09-06')).toBe(false); // domingo
    expect(occursOn(s, '2026-09-07')).toBe(true); // lunes
  });

  it('WEEKLY solo cae en los días marcados', () => {
    const s = spec({ freq: 'WEEKLY', weekdays: [1, 4] });
    expect(occursOn(s, '2026-09-07')).toBe(true); // lunes
    expect(occursOn(s, '2026-09-10')).toBe(true); // jueves
    expect(occursOn(s, '2026-09-09')).toBe(false); // miércoles
  });

  it('WEEKLY cada 2 semanas salta la intermedia', () => {
    const s = spec({ freq: 'WEEKLY', weekdays: [1], interval: 2, anchorDateKey: '2026-09-07' });
    expect(occursOn(s, '2026-09-07')).toBe(true);
    expect(occursOn(s, '2026-09-14')).toBe(false);
    expect(occursOn(s, '2026-09-21')).toBe(true);
  });

  it('MONTHLY cae el día indicado de cada mes', () => {
    const s = spec({ freq: 'MONTHLY', monthDay: 1 });
    expect(occursOn(s, '2026-10-01')).toBe(true);
    expect(occursOn(s, '2026-10-02')).toBe(false);
    expect(occursOn(s, '2026-11-01')).toBe(true);
  });

  it('QUARTERLY solo cada tres meses desde el ancla', () => {
    const s = spec({ freq: 'QUARTERLY', monthDay: 5 });
    expect(occursOn(s, '2026-09-05')).toBe(true);
    expect(occursOn(s, '2026-10-05')).toBe(false);
    expect(occursOn(s, '2026-12-05')).toBe(true);
  });

  it('YEARLY exige mes y día', () => {
    const s = spec({ freq: 'YEARLY', month: 2, monthDay: 15 });
    expect(occursOn(s, '2027-02-15')).toBe(true);
    expect(occursOn(s, '2027-02-16')).toBe(false);
    expect(occursOn(s, '2028-02-15')).toBe(true);
  });

  it('nunca ocurre antes del alta de la plantilla', () => {
    const s = spec({ freq: 'DAILY' });
    expect(occursOn(s, '2026-08-31')).toBe(false);
  });
});

describe('pendingOccurrences', () => {
  it('sin marca previa solo mira la ventana reciente, no meses hacia atrás', () => {
    const days = pendingOccurrences({
      spec: spec({ freq: 'DAILY', anchorDateKey: '2026-01-01' }),
      todayKey: '2026-09-10',
      leadDays: 0,
      lastMaterializedOn: null,
    });
    expect(days.length).toBeLessThanOrEqual(8);
    expect(days.at(-1)).toBe('2026-09-10');
  });

  it('arranca el día siguiente al último materializado', () => {
    const days = pendingOccurrences({
      spec: spec({ freq: 'DAILY' }),
      todayKey: '2026-09-05',
      leadDays: 0,
      lastMaterializedOn: '2026-09-03',
    });
    expect(days).toEqual(['2026-09-04', '2026-09-05']);
  });

  it('leadDays adelanta las que vienen', () => {
    const days = pendingOccurrences({
      spec: spec({ freq: 'YEARLY', month: 9, monthDay: 20 }),
      todayKey: '2026-09-01',
      leadDays: 30,
      lastMaterializedOn: '2026-08-31',
    });
    expect(days).toEqual(['2026-09-20']);
  });

  it('no repite lo ya materializado hoy', () => {
    const days = pendingOccurrences({
      spec: spec({ freq: 'DAILY' }),
      todayKey: '2026-09-05',
      leadDays: 0,
      lastMaterializedOn: '2026-09-05',
    });
    expect(days).toEqual([]);
  });
});

describe('describeRecurrence', () => {
  it('describe en español lo que hace la rutina', () => {
    expect(describeRecurrence(spec({ freq: 'WEEKDAYS' }), '08:30')).toBe(
      'De lunes a viernes a las 08:30',
    );
    expect(describeRecurrence(spec({ freq: 'WEEKLY', weekdays: [1] }), '09:30')).toContain('lunes');
  });
});
