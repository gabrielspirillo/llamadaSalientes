import { describe, expect, it } from 'vitest';

import { toWhatsappFormatting } from '@/lib/whatsapp/format';

describe('toWhatsappFormatting', () => {
  it('convierte la negrita de Markdown a la de WhatsApp', () => {
    expect(toWhatsappFormatting('**Fisioterapia**: 45 min')).toBe('*Fisioterapia*: 45 min');
  });

  it('convierte cada negrita de una lista, sin comerse las líneas de en medio', () => {
    const input = [
      'Ofrecemos los siguientes tratamientos:',
      '',
      '- **Entrenamiento Personal**: 40 min · 40 EUR',
      '- **Fisioterapia**: 45 min · 45 EUR',
    ].join('\n');
    expect(toWhatsappFormatting(input)).toBe(
      [
        'Ofrecemos los siguientes tratamientos:',
        '',
        '- *Entrenamiento Personal*: 40 min · 40 EUR',
        '- *Fisioterapia*: 45 min · 45 EUR',
      ].join('\n'),
    );
  });

  it('acepta también la forma con guiones bajos', () => {
    expect(toWhatsappFormatting('__Valoración__: 30 min')).toBe('*Valoración*: 30 min');
  });

  it('deja intacta la negrita que ya venía en formato WhatsApp', () => {
    expect(toWhatsappFormatting('*Valoración*: 30 min')).toBe('*Valoración*: 30 min');
  });

  it('deja la cursiva de un solo guion, que WhatsApp sí entiende', () => {
    expect(toWhatsappFormatting('te espero _mañana_')).toBe('te espero _mañana_');
  });

  it('no toca un par de asteriscos que no marca nada', () => {
    expect(toWhatsappFormatting('son 2 ** 3 sesiones')).toBe('son 2 ** 3 sesiones');
    expect(toWhatsappFormatting('cierre sin pareja **')).toBe('cierre sin pareja **');
  });

  it('respeta un texto sin formato', () => {
    expect(toWhatsappFormatting('Hola, ¿en qué te ayudo?')).toBe('Hola, ¿en qué te ayudo?');
  });
});
