import { describe, expect, it } from 'vitest';

import {
  durationFits,
  evaluateMatch,
  sameDentist,
  sameTreatment,
  slotIsEarlierEnoughThanEntry,
  withinTimeWindow,
  type MatchSettings,
  type SlotForMatching,
  type WaitlistEntryForMatching,
} from '@/lib/waitlist/match-rules';

const TX_A = 'tx-a';
const TX_B = 'tx-b';

function makeEntry(over: Partial<WaitlistEntryForMatching> = {}): WaitlistEntryForMatching {
  return {
    treatmentId: TX_A,
    assignedDentistId: 'dent-1',
    originalStartTime: new Date('2026-06-20T10:00:00Z'),
    preferredTimeWindowStart: null,
    preferredTimeWindowEnd: null,
    ...over,
  };
}

function makeSlot(over: Partial<SlotForMatching> = {}): SlotForMatching {
  return {
    treatmentId: TX_A,
    assignedDentistId: 'dent-1',
    startTime: new Date('2026-06-10T10:00:00Z'),
    endTime: new Date('2026-06-10T10:30:00Z'),
    treatmentDurationMinutes: 30,
    ...over,
  };
}

const settings: MatchSettings = {
  minAdvanceDays: 1,
  requireSameDentist: false,
  respectTimeWindow: false,
  clinicTimezone: 'Europe/Madrid',
};

describe('sameTreatment', () => {
  it('matchea cuando coinciden los treatments', () => {
    expect(sameTreatment(makeEntry(), makeSlot())).toBe(true);
  });
  it('no matchea cuando difieren', () => {
    expect(sameTreatment(makeEntry({ treatmentId: TX_A }), makeSlot({ treatmentId: TX_B }))).toBe(
      false,
    );
  });
  it('no matchea cuando alguno es null', () => {
    expect(sameTreatment(makeEntry({ treatmentId: null }), makeSlot())).toBe(false);
    expect(sameTreatment(makeEntry(), makeSlot({ treatmentId: null }))).toBe(false);
  });
});

describe('slotIsEarlierEnoughThanEntry', () => {
  it('matchea cuando el slot adelanta más que el mínimo', () => {
    expect(slotIsEarlierEnoughThanEntry(makeEntry(), makeSlot(), 1)).toBe(true);
  });
  it('falla si el slot es posterior a la cita actual', () => {
    expect(
      slotIsEarlierEnoughThanEntry(
        makeEntry({ originalStartTime: new Date('2026-06-05T10:00:00Z') }),
        makeSlot(),
        1,
      ),
    ).toBe(false);
  });
  it('falla si el slot adelanta menos del mínimo de días', () => {
    expect(
      slotIsEarlierEnoughThanEntry(
        makeEntry({ originalStartTime: new Date('2026-06-10T15:00:00Z') }),
        makeSlot(),
        1,
      ),
    ).toBe(false);
  });
});

describe('durationFits', () => {
  it('matchea cuando slot dura igual o más que el tratamiento', () => {
    expect(durationFits(makeSlot())).toBe(true);
  });
  it('falla cuando slot dura menos que el tratamiento', () => {
    expect(
      durationFits(
        makeSlot({
          endTime: new Date('2026-06-10T10:15:00Z'),
          treatmentDurationMinutes: 60,
        }),
      ),
    ).toBe(false);
  });
  it('no bloquea si no se conoce la duración', () => {
    expect(durationFits(makeSlot({ treatmentDurationMinutes: null }))).toBe(true);
  });
});

describe('sameDentist', () => {
  it('matchea cuando coincide', () => {
    expect(sameDentist(makeEntry(), makeSlot())).toBe(true);
  });
  it('no matchea cuando difiere', () => {
    expect(sameDentist(makeEntry({ assignedDentistId: 'dent-X' }), makeSlot())).toBe(false);
  });
});

describe('withinTimeWindow', () => {
  it('no bloquea si no hay ventana', () => {
    expect(withinTimeWindow(makeEntry(), makeSlot(), 'Europe/Madrid')).toBe(true);
  });
  it('matchea cuando el slot cae dentro de la ventana (TZ Madrid)', () => {
    const entry = makeEntry({
      preferredTimeWindowStart: '10:00',
      preferredTimeWindowEnd: '14:00',
    });
    const slot = makeSlot({ startTime: new Date('2026-06-10T10:30:00+02:00') });
    expect(withinTimeWindow(entry, slot, 'Europe/Madrid')).toBe(true);
  });
  it('falla cuando el slot cae fuera', () => {
    const entry = makeEntry({
      preferredTimeWindowStart: '14:00',
      preferredTimeWindowEnd: '18:00',
    });
    const slot = makeSlot({ startTime: new Date('2026-06-10T10:30:00+02:00') });
    expect(withinTimeWindow(entry, slot, 'Europe/Madrid')).toBe(false);
  });
});

describe('evaluateMatch', () => {
  it('elegible cuando todas las reglas se cumplen', () => {
    expect(evaluateMatch(makeEntry(), makeSlot(), settings)).toEqual({ eligible: true });
  });
  it('rechaza por treatment distinto', () => {
    expect(evaluateMatch(makeEntry(), makeSlot({ treatmentId: TX_B }), settings).eligible).toBe(
      false,
    );
  });
  it('rechaza por slot posterior', () => {
    const entry = makeEntry({ originalStartTime: new Date('2026-06-05T10:00:00Z') });
    expect(evaluateMatch(entry, makeSlot(), settings).eligible).toBe(false);
  });
  it('rechaza por dentista distinto cuando requireSameDentist=true', () => {
    expect(
      evaluateMatch(
        makeEntry({ assignedDentistId: 'X' }),
        makeSlot(),
        { ...settings, requireSameDentist: true },
      ).eligible,
    ).toBe(false);
  });
  it('rechaza por fuera de ventana cuando respectTimeWindow=true', () => {
    expect(
      evaluateMatch(
        makeEntry({
          preferredTimeWindowStart: '15:00',
          preferredTimeWindowEnd: '20:00',
        }),
        makeSlot({ startTime: new Date('2026-06-10T08:00:00+02:00') }),
        { ...settings, respectTimeWindow: true },
      ).eligible,
    ).toBe(false);
  });
});
