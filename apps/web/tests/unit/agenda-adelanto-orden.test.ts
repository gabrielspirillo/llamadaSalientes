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
  it('la flecha ↑ es para adelantar DÍAS: nadie del mismo día con ↑ se mueve de hora (clínica, 6/11)', () => {
    const r = rankAdvanceCandidates(
      slot,
      [c('tarde', 4, '19:00'), c('cerca', 4, '17:30'), c('manana', 5, '16:00')],
      tz,
    );
    expect(ids(r)).toEqual(['manana']);
    expect(r[0]?.phase).toBe('NEXT_DAYS_SAME_HOUR');
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

  it('en el mismo día no se mueve a nadie, tengan marca o no (clínica, 6/11)', () => {
    const r = rankAdvanceCandidates(
      slot,
      [c('r1', 4, '17:00', null), c('r2', 4, '19:30', null), c('r3', 4, '18:15')],
      tz,
    );
    expect(ids(r)).toEqual([]);
  });

  it('el orden completo: sólo los días siguientes', () => {
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
    expect(ids(r)).toEqual(['siguiente']);
  });

  it('nunca a quien dijo que no le muevan, ni a citas anteriores al hueco, ni a las que no caben', () => {
    const r = rankAdvanceCandidates(
      slot,
      [
        c('antesDelHueco', 5, '15:00'),
        c('nomover', 5, '16:00', 'NO_MOVE'),
        c('larga', 5, '16:00', 'ACCEPTS', 60),
        c('vale', 5, '16:00', null, 30),
      ],
      tz,
    );
    expect(ids(r)).toEqual(['vale']);
  });

  it('en los días siguientes también entra quien no marcó nada (no "no mover")', () => {
    const r = rankAdvanceCandidates(
      slot,
      [c('sinMarca', 5, '16:00', null), c('noMover', 5, '16:00', 'NO_MOVE')],
      tz,
    );
    expect(ids(r)).toEqual(['sinMarca']);
    expect(r[0]?.phase).toBe('NEXT_DAYS_SAME_HOUR');
  });

  it('a igual hueco el día siguiente, primero quien marcó ↑', () => {
    const r = rankAdvanceCandidates(
      slot,
      [c('sinMarca', 5, '16:00', null), c('conMarca', 5, '16:00')],
      tz,
    );
    expect(ids(r)).toEqual(['conMarca', 'sinMarca']);
  });
});

describe('prioridad marcada por la clínica', () => {
  it('"ofrecerle el primer hueco" manda dentro de su fase', () => {
    const r = rankAdvanceCandidates(
      slot,
      [
        c('misma', 5, '16:00'),
        { ...c('prioritaria', 5, '16:45'), advancePriority: true },
        c('otroDia', 6, '16:00'),
      ],
      tz,
    );
    expect(ids(r)).toEqual(['prioritaria', 'misma', 'otroDia']);
  });

  it('la prioridad va primero aunque su cita sea a otra hora o más lejos (Alegría, 9/11)', () => {
    const r = rankAdvanceCandidates(
      slot,
      [c('misma', 5, '16:00'), { ...c('lejos', 12, '18:30'), advancePriority: true }],
      tz,
    );
    expect(ids(r)).toEqual(['lejos', 'misma']);
    expect(r[0]?.phase).toBe('PRIORITY');
  });

  it('ni con prioridad se mueve a nadie del mismo día', () => {
    const r = rankAdvanceCandidates(
      slot,
      [{ ...c('hoyMasTarde', 4, '18:00'), advancePriority: true }],
      tz,
    );
    expect(ids(r)).toEqual([]);
  });

  it('"no mover" no entra ni con prioridad', () => {
    const r = rankAdvanceCandidates(
      slot,
      [{ ...c('quieta', 6, '18:00', 'NO_MOVE'), advancePriority: true }],
      tz,
    );
    expect(ids(r)).toEqual([]);
  });
});
