import { fullWidthOnMobile } from '@/components/agenda/patient-header';
import { describe, expect, it } from 'vitest';

const f = (label: string, extra: { wide?: boolean; emphasis?: boolean } = {}) => ({
  label,
  value: '·',
  ...extra,
});

describe('tira de datos de la ficha en móvil', () => {
  it('la edad y los tutores ocupan la fila; contacto y próxima cita van juntos', () => {
    expect(
      fullWidthOnMobile([
        f('Edad', { emphasis: true }),
        f('Tutores', { wide: true }),
        f('Contacto'),
        f('Próxima cita'),
      ]),
    ).toEqual([true, true, false, false]);
  });

  it('un dato que se quedaría solo antes de uno ancho se estira (sin celda gris vacía)', () => {
    expect(fullWidthOnMobile([f('A'), f('Tutores', { wide: true }), f('B'), f('C')])).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('el último impar se estira', () => {
    expect(fullWidthOnMobile([f('A'), f('B'), f('C')])).toEqual([false, false, true]);
  });
});
