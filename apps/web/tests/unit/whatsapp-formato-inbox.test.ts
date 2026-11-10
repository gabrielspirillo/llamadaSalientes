import { describe, expect, it } from 'vitest';

import { parseWhatsappFormatting } from '@/lib/whatsapp/format';

describe('formato de WhatsApp pintado en el inbox', () => {
  it('negrita y cursiva como en el móvil', () => {
    expect(parseWhatsappFormatting('necesitamos *confirmar* la cita')).toEqual([
      { text: 'necesitamos ' },
      { text: 'confirmar', bold: true },
      { text: ' la cita' },
    ]);
  });
  it('cursiva de varias líneas (la nota del aviso del día)', () => {
    const r = parseWhatsappFormatting('_Nota: te reservamos la cita.\nSi no contestas, se anula._');
    expect(r).toEqual([
      { text: 'Nota: te reservamos la cita.\nSi no contestas, se anula.', italic: true },
    ]);
  });
  it('anidado: negrita dentro de cursiva', () => {
    expect(parseWhatsappFormatting('_Se avisa con *6 HORAS* de antelación_')).toEqual([
      { text: 'Se avisa con ', italic: true },
      { text: '6 HORAS', italic: true, bold: true },
      { text: ' de antelación', italic: true },
    ]);
  });
  it('no toca guiones bajos dentro de palabras ni asteriscos sueltos', () => {
    expect(parseWhatsappFormatting('archivo_final_v2.pdf y 3 * 4')).toEqual([
      { text: 'archivo_final_v2.pdf y 3 * 4' },
    ]);
  });
  it('no cruza un párrafo vacío', () => {
    expect(parseWhatsappFormatting('*hola\n\nadiós*')).toEqual([{ text: '*hola\n\nadiós*' }]);
  });
});
