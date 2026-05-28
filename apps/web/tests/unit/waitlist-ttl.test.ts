import { describe, expect, it } from 'vitest';

import { computeTtl, type TtlSettings } from '@/lib/waitlist/ttl';

const settings: TtlSettings = {
  ttlMinutesDefault: 240,
  ttlMinutesNearSlot: 60,
  nearSlotHoursThreshold: 12,
  minSkipHoursThreshold: 2,
};

const now = new Date('2026-06-01T10:00:00Z');

describe('computeTtl', () => {
  it('skipea cuando el slot ya pasó', () => {
    const slot = new Date('2026-06-01T09:00:00Z');
    const res = computeTtl(slot, settings, now);
    expect(res.shouldSkip).toBe(true);
    if (res.shouldSkip) expect(res.reason).toBe('slot_in_past');
  });

  it('skipea cuando faltan menos del umbral mínimo', () => {
    const slot = new Date('2026-06-01T11:30:00Z'); // 1.5h
    const res = computeTtl(slot, settings, now);
    expect(res.shouldSkip).toBe(true);
    if (res.shouldSkip) expect(res.reason).toBe('slot_too_close');
  });

  it('usa TTL reducido si el slot está cercano pero por encima del mínimo', () => {
    const slot = new Date('2026-06-01T15:00:00Z'); // 5h
    const res = computeTtl(slot, settings, now);
    expect(res.shouldSkip).toBe(false);
    if (!res.shouldSkip) {
      // 5h * 0.8 = 240 min, pero settings.near = 60. Como 60 < cap, devuelve 60.
      expect(res.ttlMinutes).toBeLessThanOrEqual(settings.ttlMinutesNearSlot);
    }
  });

  it('usa TTL default si el slot está lejos', () => {
    const slot = new Date('2026-06-03T10:00:00Z'); // 48h
    const res = computeTtl(slot, settings, now);
    expect(res.shouldSkip).toBe(false);
    if (!res.shouldSkip) {
      expect(res.ttlMinutes).toBe(settings.ttlMinutesDefault);
      const ms = res.expiresAt.getTime() - now.getTime();
      expect(ms).toBeGreaterThan(0);
    }
  });

  it('cap por 80% del tiempo restante: nunca expira después del slot', () => {
    const slot = new Date('2026-06-01T13:00:00Z'); // 3h = 180 min. cap = 144
    const res = computeTtl(slot, settings, now);
    expect(res.shouldSkip).toBe(false);
    if (!res.shouldSkip) {
      expect(res.ttlMinutes).toBeLessThanOrEqual(144);
      expect(res.expiresAt.getTime()).toBeLessThan(slot.getTime());
    }
  });
});
