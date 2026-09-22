import { describe, expect, it } from 'vitest';

import { normalizeWhatsappE164, parseWhatsappPhone } from '@/lib/whatsapp/phone';

/**
 * El número que alguien teclea en la ficha del profesional.
 *
 * Lo que se fija aquí es lo que NO se acepta: un móvil local sin prefijo. Ese
 * caso es el que convertía "600 11 22 33" en un +600112233 de otro país, al que
 * el mensaje sale sin error y no lo recibe nadie.
 */
describe('parseWhatsappPhone', () => {
  it('acepta las tres formas de escribir un internacional', () => {
    expect(parseWhatsappPhone('+34 600 11 22 33')).toEqual({ ok: true, e164: '+34600112233' });
    expect(parseWhatsappPhone('0034600112233')).toEqual({ ok: true, e164: '+34600112233' });
    expect(parseWhatsappPhone('34600112233')).toEqual({ ok: true, e164: '+34600112233' });
  });

  it('limpia lo que la gente escribe alrededor del número', () => {
    expect(normalizeWhatsappE164('(+34) 600-11.22.33')).toBe('+34600112233');
  });

  it('rechaza el móvil local sin prefijo', () => {
    const r = parseWhatsappPhone('600 11 22 33');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('prefijo del país');
  });

  it('rechaza el 0 nacional pegado al prefijo', () => {
    const r = parseWhatsappPhone('+0034600112233');
    expect(r.ok).toBe(false);
  });

  it('rechaza lo que no es un número', () => {
    expect(parseWhatsappPhone('')).toEqual({ ok: false, error: 'Escribe el número de WhatsApp.' });
    expect(parseWhatsappPhone('no tengo').ok).toBe(false);
    expect(parseWhatsappPhone('+34 600 11 22 33 44 55 66').ok).toBe(false);
    expect(parseWhatsappPhone('34+600112233').ok).toBe(false);
  });

  it('normalizeWhatsappE164 devuelve null en vez de un número inventado', () => {
    expect(normalizeWhatsappE164('600112233')).toBeNull();
    expect(normalizeWhatsappE164(null)).toBeNull();
  });
});
