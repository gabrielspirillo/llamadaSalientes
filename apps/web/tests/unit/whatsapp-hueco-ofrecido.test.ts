import { describe, expect, it } from 'vitest';

import {
  dayMentioned,
  lastConfirmedDate,
  relativeDayInText,
  relativeDayLabel,
  slotNotOffered,
  timeMentioned,
} from '@/lib/whatsapp/agent/slot-mention';

const today = '2026-11-03'; // martes

describe('hueco ofrecido antes de reservar', () => {
  it('la hora y el día tienen que estar en la conversación', () => {
    const texts = [
      'Hola, quería cita para mañana a las 16:00',
      'Mañana a las 16:00 no me queda nada.',
    ];
    // El jueves no salió nunca: no se reserva.
    expect(slotNotOffered('2026-11-05 16:00', texts, today)?.missing).toBe('day');
    // Mañana sí salió (miércoles 4).
    expect(slotNotOffered('2026-11-04 16:00', texts, today)).toBeNull();
  });

  it('acepta el día como lo dice la gente', () => {
    expect(dayMentioned('2026-11-05', ['¿el jueves?'], today)).toBe(true);
    expect(dayMentioned('2026-11-05', ['el 5 de noviembre'], today)).toBe(true);
    expect(dayMentioned('2026-11-05', ['tengo el jueves 5 a las 16:00'], today)).toBe(true);
    expect(dayMentioned('2026-11-03', ['¿hoy puede ser?'], today)).toBe(true);
    expect(dayMentioned('2026-11-04', ['por la mañana no puedo'], today)).toBe(false);
    expect(dayMentioned('2026-11-04', ['mañana por la tarde'], today)).toBe(true);
  });

  it('acepta la hora como la dice la gente', () => {
    expect(timeMentioned('16:00', ['a las 4'])).toBe(true);
    expect(timeMentioned('16:00', ['a las cuatro'])).toBe(true);
    expect(timeMentioned('16:00', ['16h'])).toBe(true);
    expect(timeMentioned('16:30', ['a las 4 y media'])).toBe(true);
    expect(timeMentioned('16:30', ['16.30'])).toBe(true);
    expect(timeMentioned('16:00', ['a las 16:30'])).toBe(false);
    expect(timeMentioned('18:45', ['18:45 con Raquel'])).toBe(true);
    expect(timeMentioned('18:45', ['18:00 o 18:30'])).toBe(false);
  });
});

describe('días relativos', () => {
  it('etiqueta hoy, mañana o el día de la semana', () => {
    expect(relativeDayLabel('2026-11-03', today)).toBe('hoy');
    expect(relativeDayLabel('2026-11-04', today)).toBe('mañana');
    expect(relativeDayLabel('2026-11-06', today)).toBe('el viernes 6');
  });

  it('lee "mañana" como día, no como franja', () => {
    expect(relativeDayInText('La cita es para mañana a las 16:00')).toBe('mañana');
    expect(relativeDayInText('Por la mañana no hay huecos')).toBeNull();
    expect(relativeDayInText('Nos vemos hoy')).toBe('hoy');
  });

  it('saca la última fecha confirmada por la clínica', () => {
    expect(
      lastConfirmedDate(
        ['Ya tienes la cita reservada para Clara\n\n🗓️ Jueves, 5 de noviembre\n⏰ 16:00'],
        today,
      ),
    ).toBe('2026-11-05');
    expect(lastConfirmedDate(['sin fecha'], today)).toBeNull();
  });
});
