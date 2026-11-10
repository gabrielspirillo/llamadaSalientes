import { describe, expect, it } from 'vitest';

import { fullNameWrittenByFamily, reviewFinalText } from '@/lib/whatsapp/agent/index';

describe('fullNameWrittenByFamily', () => {
  it('nombre completo escrito por la familia y partido mal por el modelo', () => {
    expect(
      fullNameWrittenByFamily('Lucas Andreev', 'Petrov', ['Se llama Lucas Andreev Petrov']),
    ).toBe(true);
  });
  it('con tildes y mayúsculas distintas', () => {
    expect(
      fullNameWrittenByFamily('José', 'Pérez Gómez', ['jose perez gomez, nació el 3/2/25']),
    ).toBe(true);
  });
  it('dos palabras no bastan: sigue faltando un apellido', () => {
    expect(fullNameWrittenByFamily('Leo', 'Martín', ['Leo Martín'])).toBe(false);
  });
  it('si la familia no lo escribió así, no se da por bueno', () => {
    expect(fullNameWrittenByFamily('Juan Pablo', 'García', ['Juan Pablo'])).toBe(false);
  });
});

describe('reviewFinalText: bloque 2', () => {
  const now = new Date('2026-11-10T10:00:00Z');
  it('rechaza "tienes razón" y "perdona"', () => {
    expect(reviewFinalText('Tienes razón, ese hueco ya no está.', [], true, now)?.code).toBe(
      'apology',
    );
    expect(reviewFinalText('Perdona, me he liado.', [], true, now)?.code).toBe('apology');
  });
  it('no confunde "razón" suelta', () => {
    expect(reviewFinalText('Por esa razón te ofrezco el jueves.', [], true, now)).toBeNull();
  });
  it('"sí" a buscar huecos sin check_availability', () => {
    const r = reviewFinalText('¿Qué día te viene mejor?', [], true, now, 'Sí, por favor', [
      'El miércoles no me queda ningún hueco. Si quieres, te digo lo más cercano que hay con Raquel 😊',
    ]);
    expect(r?.code).toBe('search_not_done');
  });
  it('misma pregunta repetida', () => {
    const r = reviewFinalText(
      '¿Es la primera vez que acudes a la clínica?',
      [],
      true,
      now,
      'Hola',
      ['Hola😊 ¿Es la primera vez que acudes a la clínica?'],
    );
    expect(r?.code).toBe('repeated_question');
  });
  it('una pregunta nueva pasa', () => {
    const r = reviewFinalText('¿Cuál es su fecha de nacimiento?', [], true, now, 'No, ya he ido', [
      '¿Es la primera vez que acudes a la clínica?',
    ]);
    expect(r).toBeNull();
  });
});
