import {
  DEFAULT_DEMO_ALLOWED_COUNTRY_CODES,
  describeAllowedCountries,
  isDestinationAllowed,
  matchAllowedCountryCode,
  parseAllowedCountryCodes,
} from '@/lib/calls/destination-allowlist';
import { describe, expect, it } from 'vitest';

describe('lista blanca de países de la demo pública', () => {
  describe('parseAllowedCountryCodes', () => {
    it('sin variable usa el defecto', () => {
      expect(parseAllowedCountryCodes(undefined)).toEqual([...DEFAULT_DEMO_ALLOWED_COUNTRY_CODES]);
      expect(parseAllowedCountryCodes(null)).toEqual([...DEFAULT_DEMO_ALLOWED_COUNTRY_CODES]);
    });

    it('acepta "+", espacios y duplicados', () => {
      expect(parseAllowedCountryCodes(' +34, 598 ,54,54 ')).toEqual(['34', '598', '54']);
    });

    it('una variable vacía o inválida NUNCA abre todos los países: cae al defecto', () => {
      expect(parseAllowedCountryCodes('')).toEqual([...DEFAULT_DEMO_ALLOWED_COUNTRY_CODES]);
      expect(parseAllowedCountryCodes('   ')).toEqual([...DEFAULT_DEMO_ALLOWED_COUNTRY_CODES]);
      expect(parseAllowedCountryCodes('todos,*,ES')).toEqual([
        ...DEFAULT_DEMO_ALLOWED_COUNTRY_CODES,
      ]);
    });

    it('descarta lo que no sean 1 a 4 dígitos pero conserva lo válido', () => {
      expect(parseAllowedCountryCodes('34,España,12345,+1809')).toEqual(['34', '1809']);
    });
  });

  describe('isDestinationAllowed con el defecto', () => {
    it.each([
      ['+59899123456', 'Uruguay'],
      ['+34612345678', 'España'],
      ['+5491112345678', 'Argentina'],
      ['+5215512345678', 'México'],
      ['+56912345678', 'Chile'],
      ['+573001234567', 'Colombia'],
      ['+51987654321', 'Perú'],
    ])('permite %s (%s)', (phone) => {
      expect(isDestinationAllowed(phone)).toBe(true);
    });

    // Los países de la ráfaga de fraude del 5 y 7 de septiembre de 2026 (números sintéticos).
    it.each([
      ['+972521234567', 'Israel'],
      ['+381611234567', 'Serbia'],
      ['+254712345678', 'Kenia'],
      ['+94771234567', 'Sri Lanka'],
      ['+263771234567', 'Zimbabue'],
      ['+38267123456', 'Montenegro'],
      ['+18095551234', 'Rep. Dominicana (+1 no está en el defecto)'],
    ])('rechaza %s (%s)', (phone) => {
      expect(isDestinationAllowed(phone)).toBe(false);
    });

    it('no confunde un país permitido con un prefijo parecido', () => {
      // 59 no es 598: +591 (Bolivia), +593 (Ecuador) y +595 (Paraguay) quedan fuera.
      expect(isDestinationAllowed('+59171234567')).toBe(false);
      expect(isDestinationAllowed('+593991234567')).toBe(false);
      expect(isDestinationAllowed('+595981234567')).toBe(false);
    });
  });

  describe('matchAllowedCountryCode', () => {
    it('devuelve el indicativo que encaja y null si ninguno', () => {
      expect(matchAllowedCountryCode('+59899123456')).toBe('598');
      expect(matchAllowedCountryCode('+972521234567')).toBeNull();
    });

    it('si varios encajan gana el más largo', () => {
      expect(matchAllowedCountryCode('+59899123456', ['5', '598'])).toBe('598');
      expect(matchAllowedCountryCode('+18095551234', ['1', '1809'])).toBe('1809');
    });
  });

  describe('describeAllowedCountries', () => {
    it('enumera en castellano con "y" final', () => {
      expect(describeAllowedCountries()).toBe(
        'España, Argentina, Uruguay, México, Chile, Colombia y Perú',
      );
    });

    it('un código sin nombre se muestra como +NN y uno solo va sin coma', () => {
      expect(describeAllowedCountries(['34', '999'])).toBe('España y +999');
      expect(describeAllowedCountries(['598'])).toBe('Uruguay');
    });
  });
});
