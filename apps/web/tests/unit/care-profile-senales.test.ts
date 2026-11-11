import {
  clampPrior,
  countRedFlags,
  describeRedFlags,
  isRedFlagAppointment,
  priorForTotal,
  redFlagLevel,
  totalRedFlags,
} from '@/lib/care-profile/signals';
import { describe, expect, it } from 'vitest';

describe('banderas rojas', () => {
  it('una falta siempre es bandera', () => {
    expect(isRedFlagAppointment({ status: 'NO_SHOW' })).toBe('NO_SHOW');
  });

  it('la cancelación de la familia cuenta; la de la clínica no', () => {
    expect(isRedFlagAppointment({ status: 'CANCELLED', cancelledBy: 'PATIENT' })).toBe('CANCELLED');
    expect(isRedFlagAppointment({ status: 'CANCELLED', cancelledBy: 'CLINIC' })).toBeNull();
  });

  it('una cancelación sin dato de quién (citas antiguas) cuenta como de la familia', () => {
    expect(isRedFlagAppointment({ status: 'CANCELLED', cancelledBy: null })).toBe('CANCELLED');
    expect(isRedFlagAppointment({ status: 'CANCELLED' })).toBe('CANCELLED');
  });

  it('las citas atendidas o pendientes no son banderas', () => {
    for (const status of ['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED']) {
      expect(isRedFlagAppointment({ status })).toBeNull();
    }
  });

  it('cuenta faltas, cancelaciones y las anteriores por separado', () => {
    const c = countRedFlags(
      [
        { status: 'NO_SHOW' },
        { status: 'NO_SHOW' },
        { status: 'CANCELLED', cancelledBy: 'PATIENT' },
        { status: 'CANCELLED', cancelledBy: 'CLINIC' },
        { status: 'COMPLETED' },
      ],
      3,
    );
    expect(c).toEqual({ noShows: 2, cancellations: 1, prior: 3 });
    expect(totalRedFlags(c)).toBe(6);
  });

  it('el ajuste a mano se recorta a -999–99 y a entero', () => {
    expect(clampPrior(-2)).toBe(-2);
    expect(clampPrior(-5000)).toBe(-999);
    expect(clampPrior(2.7)).toBe(2);
    expect(clampPrior(500)).toBe(99);
    expect(clampPrior(Number.NaN)).toBe(0);
  });

  it('el desglose habla en singular y plural', () => {
    expect(describeRedFlags({ noShows: 1, cancellations: 2, prior: 0 })).toBe(
      '1 falta · 2 cancelaciones',
    );
    expect(describeRedFlags({ noShows: 0, cancellations: 1, prior: 1 })).toBe(
      '1 cancelación · 1 anterior',
    );
    expect(describeRedFlags({ noShows: 0, cancellations: 0, prior: 0 })).toBe('');
  });

  it('el nivel sube con el número', () => {
    expect(redFlagLevel(0)).toBe('NONE');
    expect(redFlagLevel(1)).toBe('LOW');
    expect(redFlagLevel(2)).toBe('MEDIUM');
    expect(redFlagLevel(4)).toBe('HIGH');
  });
});

describe('cambiar la cita de día no es una cancelación (6/11)', () => {
  it('la cita vieja anulada por "Cambiada por el paciente" no suma bandera', () => {
    expect(
      isRedFlagAppointment({
        status: 'CANCELLED',
        cancelledBy: 'PATIENT',
        cancelReason: 'Cambiada por el paciente',
      }),
    ).toBeNull();
    expect(
      isRedFlagAppointment({
        status: 'CANCELLED',
        cancelledBy: 'PATIENT',
        cancelReason: 'No puede venir',
      }),
    ).toBe('CANCELLED');
  });
});

describe('banderas rojas: el total lo pone la clínica (11/11)', () => {
  const contadas = { noShows: 1, cancellations: 2, prior: 0 };

  it('poner 0 quita también las contadas de la agenda', () => {
    const prior = priorForTotal(contadas, 0);
    expect(prior).toBe(-3);
    expect(totalRedFlags({ ...contadas, prior })).toBe(0);
    expect(describeRedFlags({ ...contadas, prior })).toBe('');
  });

  it('una falta nueva vuelve a sumar desde ahí', () => {
    const prior = priorForTotal(contadas, 0);
    expect(totalRedFlags({ ...contadas, noShows: 2, prior })).toBe(1);
  });

  it('subir el total suma las de antes de la plataforma', () => {
    expect(priorForTotal(contadas, 5)).toBe(2);
    expect(describeRedFlags({ ...contadas, prior: 2 })).toContain('2 anteriores');
  });

  it('el total nunca baja de 0', () => {
    expect(totalRedFlags({ noShows: 0, cancellations: 0, prior: -4 })).toBe(0);
  });
});
