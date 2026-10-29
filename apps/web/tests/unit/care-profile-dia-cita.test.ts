import { describe, expect, it } from 'vitest';

import { type DayOfState, clockMinutes, nextDayOfStep, whenToday } from '@/lib/care-profile/day-of';

const times = {
  reminderAt: '08:00',
  nudgeAt: '09:00',
  callAt: ['11:00', '12:00'],
  cancelAt: '12:30',
};
const at = (h: number, m = 0) => h * 60 + m;
const today = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 2, h, m));
const fresh: DayOfState = { reminderSentAt: null, nudgeSentAt: null, callsDone: 0 };

function step(nowH: number, nowM: number, state: DayOfState = fresh, start = at(17, 30)) {
  return nextDayOfStep({
    times,
    state,
    now: today(nowH, nowM),
    nowMinute: at(nowH, nowM),
    startMinute: start,
  });
}

describe('confirmación el día de la cita', () => {
  it('lee la hora de pared', () => {
    expect(clockMinutes('12:30')).toBe(750);
    expect(clockMinutes('25:00')).toBeNull();
  });

  it('nada antes de las 8; a las 8 el recordatorio', () => {
    expect(step(7, 55)).toBeNull();
    expect(step(8, 0)).toEqual({ kind: 'reminder' });
  });

  it('a las 9 insiste, a las 11 y 12 avisa para llamar, a las 12:30 anula', () => {
    const sent = { ...fresh, reminderSentAt: today(8, 0) };
    expect(step(8, 45, sent)).toBeNull();
    expect(step(9, 0, sent)).toEqual({ kind: 'nudge' });
    const nudged = { ...sent, nudgeSentAt: today(9, 0) };
    expect(step(10, 0, nudged)).toBeNull();
    expect(step(11, 0, nudged)).toEqual({ kind: 'call', index: 0 });
    expect(step(12, 0, { ...nudged, callsDone: 1 })).toEqual({ kind: 'call', index: 1 });
    expect(step(12, 30, { ...nudged, callsDone: 2 })).toEqual({ kind: 'cancel' });
  });

  it('a las 12:30 anula aunque falte algún aviso intermedio', () => {
    const sent = { ...fresh, reminderSentAt: today(8, 0) };
    expect(step(12, 35, sent)).toEqual({ kind: 'cancel' });
  });

  it('no espera 30 min tras un recordatorio tardío antes de insistir', () => {
    const late = { ...fresh, reminderSentAt: today(10, 0) };
    expect(step(10, 10, late)).toBeNull();
    expect(step(10, 30, late)).toEqual({ kind: 'nudge' });
  });

  it('una cita de la mañana no se anula a las 12:30 ni se avisa tras empezar', () => {
    const sent = { ...fresh, reminderSentAt: today(8, 0), nudgeSentAt: today(9, 0) };
    expect(step(10, 0, sent, at(10, 0))).toBeNull();
    expect(step(9, 50, { ...sent, callsDone: 0 }, at(12, 0))).toBeNull();
    expect(step(12, 30, { ...sent, callsDone: 2 }, at(12, 15))).toBeNull();
  });

  it('esta tarde / esta mañana', () => {
    expect(whenToday(at(17, 30))).toBe('esta tarde');
    expect(whenToday(at(10, 0))).toBe('esta mañana');
  });
});
