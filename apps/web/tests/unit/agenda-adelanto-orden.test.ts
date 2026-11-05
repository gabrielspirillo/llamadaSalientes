import { describe, expect, it } from 'vitest';

import { type RankCandidate, rankAdvanceCandidates } from '@/lib/agenda/advance-ranking';

const tz = 'Europe/Madrid';
// Hueco: miércoles 4 de noviembre de 2026, 16:00-16:45 (hora de Madrid, UTC+1).
const at = (day: number, hhmm: string, minutes = 45) => {
  const [h, m] = hhmm.split(':').map(Number);
  const start = new Date(Date.UTC(2026, 10, day, (h ?? 0) - 1, m ?? 0));
  return { startsAt: start, endsAt: new Date(start.getTime() + minutes * 60_000) };
};
const slot = at(4, '16:00');
const c = (
  id: string,
  day: number,
  hhmm: string,
  pref: RankCandidate['advancePreference'] = 'ACCEPTS',
  minutes = 45,
): RankCandidate => ({ id, ...at(day, hhmm, minutes), advancePreference: pref });

const ids = (r: ReturnType<typeof rankAdvanceCandidates>) => r.map((x) => x.candidate.id);

describe('a quién se le ofrece un hueco libre', () => {
  it('primero quien quiere adelantar ese mismo día, la cita más cercana antes', () => {
    const r = rankAdvanceCandidates(
      slot,
      [c('tarde', 4, '19:00'), c('cerca', 4, '17:30'), c('manana', 5, '16:00')],
      tz,
    );
    expect(ids(r).slice(0, 2)).toEqual(['cerca', 'tarde']);
    expect(r[0]?.phase).toBe('SAME_DAY_WANTS');
  });

  it('sin nadie ese día: al día siguiente misma hora, luego la de antes, luego la de después', () => {
    const r = rankAdvanceCandidates(
      slot,
      [
        c('despues', 5, '16:45'),
        c('misma', 5, '16:00'),
        c('antes', 5, '15:15'),
        c('lejos', 5, '19:00'),
      ],
      tz,
    );
    expect(ids(r)).toEqual(['misma', 'antes', 'despues']);
    expect(r.every((x) => x.phase === 'NEXT_DAYS_SAME_HOUR')).toBe(true);
  });

  it('recorre tres días siguientes, uno a uno', () => {
    const r = rankAdvanceCandidates(
      slot,
      [c('d3', 7, '16:00'), c('d2', 6, '16:45'), c('d1', 5, '15:15'), c('d4', 8, '16:00')],
      tz,
    );
    expect(ids(r)).toEqual(['d1', 'd2', 'd3']);
  });

  it('agotado todo, el resto del mismo día sin preferencia desde la última hora', () => {
    const r = rankAdvanceCandidates(
      slot,
      [c('r1', 4, '17:00', null), c('r2', 4, '19:30', null), c('r3', 4, '18:15', null)],
      tz,
    );
    expect(ids(r)).toEqual(['r2', 'r3', 'r1']);
    expect(r[0]?.phase).toBe('SAME_DAY_REST');
  });

  it('el orden completo respeta las tres fases', () => {
    const r = rankAdvanceCandidates(
      slot,
      [
        c('resto', 4, '19:00', null),
        c('siguiente', 5, '16:00'),
        c('mismo', 4, '18:00'),
        c('nomover', 4, '17:00', 'NO_MOVE'),
      ],
      tz,
    );
    expect(ids(r)).toEqual(['mismo', 'siguiente', 'resto']);
  });

  it('nunca a quien dijo que no le muevan, ni a citas anteriores al hueco, ni a las que no caben', () => {
    const r = rankAdvanceCandidates(
      slot,
      [
        c('antesDelHueco', 4, '15:00'),
        c('nomover', 4, '18:00', 'NO_MOVE'),
        c('larga', 4, '18:00', 'ACCEPTS', 60),
        c('vale', 4, '18:00', 'ACCEPTS', 30),
      ],
      tz,
    );
    expect(ids(r)).toEqual(['vale']);
  });

  it('sin preferencia en los días siguientes no se ofrece', () => {
    const r = rankAdvanceCandidates(slot, [c('x', 5, '16:00', null)], tz);
    expect(r).toEqual([]);
  });
});

describe('prioridad marcada por la clínica', () => {
  it('"ofrecerle el primer hueco" manda dentro de su fase', () => {
    const r = rankAdvanceCandidates(
      slot,
      [
        c('cerca', 4, '17:00'),
        { ...c('prioritaria', 4, '19:30'), advancePriority: true },
        c('siguiente', 5, '16:00'),
      ],
      tz,
    );
    expect(ids(r)).toEqual(['prioritaria', 'cerca', 'siguiente']);
  });
});
