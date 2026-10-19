import { describe, expect, it } from 'vitest';

import { dialPrefixForTimezone, withDialPrefix, withoutDialPrefix } from '@/lib/phone-prefix';

describe('prefijo telefónico de la clínica', () => {
  it('sale de la timezone', () => {
    expect(dialPrefixForTimezone('Europe/Madrid')).toBe('+34');
    expect(dialPrefixForTimezone('America/Argentina/Buenos_Aires')).toBe('+54');
    expect(dialPrefixForTimezone('Asia/Tokyo')).toBeNull();
  });

  it('antepone el prefijo a los nueve dígitos y respeta otro prefijo', () => {
    expect(withDialPrefix('646 55 66 19', '+34')).toBe('+34646 55 66 19');
    expect(withDialPrefix('+33 6 12 34 56 78', '+34')).toBe('+33 6 12 34 56 78');
    expect(withDialPrefix('0033612345678', '+34')).toBe('0033612345678');
    expect(withDialPrefix('  ', '+34')).toBe('');
  });

  it('enseña el número sin el prefijo de la clínica', () => {
    expect(withoutDialPrefix('+34646556619', '+34')).toBe('646556619');
    expect(withoutDialPrefix('+33612345678', '+34')).toBe('+33612345678');
  });
});
