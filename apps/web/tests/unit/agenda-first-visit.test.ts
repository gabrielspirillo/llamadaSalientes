import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ db: {} }));

import { decideFirstVisit } from '@/lib/agenda/first-visit';

describe('decideFirstVisit', () => {
  it('con historia nunca es primera visita, diga lo que diga el tratamiento', () => {
    expect(decideFirstVisit(true, true)).toBe(false);
    expect(decideFirstVisit(true, null)).toBe(false);
  });

  it('sin historia manda el tratamiento y, sin él, es primera', () => {
    expect(decideFirstVisit(false, false)).toBe(false);
    expect(decideFirstVisit(false, true)).toBe(true);
    expect(decideFirstVisit(false, null)).toBe(true);
  });
});
