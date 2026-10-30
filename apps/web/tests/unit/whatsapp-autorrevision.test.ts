import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/client', () => ({ db: {} }));

import { isGenericGreeting, reviewFinalText } from '@/lib/whatsapp/agent';
import type { ToolCallTrace } from '@/lib/whatsapp/agent/types';

const trace = (name: string, result: string, ok = true): ToolCallTrace => ({
  name,
  args: {},
  ok,
  result,
  latencyMs: 1,
});

describe('autorrevisión del texto final', () => {
  it('no deja decir que la cita está reservada sin book_appointment', () => {
    const r = reviewFinalText(
      'Vale, te reservo el martes 3 a las 18:00 con Raquel López.',
      [],
      true,
    );
    expect(r?.code).toBe('booking_claim');
  });

  it('las ofertas no cuentan como reserva', () => {
    expect(reviewFinalText('Si te va bien, te la reservo.', [], true)).toBeNull();
    expect(reviewFinalText('Dime cuál prefieres y te la reservo.', [], true)).toBeNull();
    expect(reviewFinalText('¿Te la reservo?', [], true)).toBeNull();
  });

  it('con la reserva hecha en este turno, no corrige', () => {
    const done = [trace('book_appointment', 'Cita agendada: martes, 3 de noviembre a las 18:00.')];
    expect(reviewFinalText('Ya tienes la cita reservada para Nico.', done, true)).toBeNull();
  });

  it('una reserva rechazada no cuenta como hecha', () => {
    const failed = [trace('book_appointment', 'Esa hora no está libre con Raquel López.')];
    expect(reviewFinalText('Listo, cita reservada para el martes.', failed, true)?.code).toBe(
      'booking_claim',
    );
  });

  it('no deja que el modelo decida por la edad sin preguntar al servidor', () => {
    const r = reviewFinalText(
      'Pau sería mayor de 4 años, así que no podemos darle cita.',
      [],
      true,
    );
    expect(r?.code).toBe('age_guess');
    const server = [
      trace(
        'register_patient',
        'NO se da de alta: la clínica sólo atiende a bebés y niños de 0 a 4 años',
      ),
    ];
    expect(
      reviewFinalText('Lo siento, es mayor de 4 años y no podemos atenderle.', server, true),
    ).toBeNull();
    // Sin perfil de atención no hay reglas de edad que vigilar.
    expect(reviewFinalText('Es mayor de 4 años.', [], false)).toBeNull();
  });
});

describe('saludo genérico', () => {
  it('reconoce la presentación del prompt base', () => {
    expect(
      isGenericGreeting('Hola, soy el asistente virtual de Respinens, ¿en qué te puedo ayudar?'),
    ).toBe(true);
    expect(isGenericGreeting('Hola, soy Lucía. ¿En qué puedo ayudarte? 😊')).toBe(true);
    // Si además atiende algo, no se toca.
    expect(
      isGenericGreeting(
        'Hola, soy Lucía, ¿en qué te puedo ayudar? Para la cita necesito el nombre del peque.',
      ),
    ).toBe(false);
    expect(isGenericGreeting('Perfecto, ¿en qué te puedo ayudar?')).toBe(false);
  });
});

describe('nombre del tutor', () => {
  it('descarta los rellenos del modelo', async () => {
    const { cleanGuardianName } = await import('@/lib/care-profile/agent');
    expect(cleanGuardianName('Titular del teléfono', 'Leo Gómez')).toBe('');
    expect(cleanGuardianName('Vega Ortiz Ramos', 'Vega Ortiz Ramos')).toBe('');
    expect(cleanGuardianName('  ', 'Leo')).toBe('');
    expect(cleanGuardianName('Jose', 'Nico Ruiz Moya')).toBe('Jose');
  });
});

describe('respuesta vacía', () => {
  it('"OK" sin reserva se devuelve al modelo', () => {
    expect(reviewFinalText('OK', [], true)?.code).toBe('empty_reply');
    const done = [trace('book_appointment', 'Cita agendada: martes a las 16:30.')];
    expect(reviewFinalText('OK', done, true)).toBeNull();
  });
});

describe('nombres de relleno', () => {
  it('no son nombres', async () => {
    const { isPlaceholderName } = await import('@/lib/care-profile/agent');
    for (const n of ['[pendiente]', 'pendiente', 'Hija', 'niño', '', '<nombre>']) {
      expect(isPlaceholderName(n)).toBe(true);
    }
    for (const n of ['Bruno', 'Vega', 'Martí', 'Pinto Ríos'])
      expect(isPlaceholderName(n)).toBe(false);
  });

  it('"tendría más de 4 años" sin servidor se corrige', () => {
    expect(
      reviewFinalText(
        'Lo siento, no puedo dar cita porque con esa fecha tendría más de 4 años.',
        [],
        true,
      )?.code,
    ).toBe('age_guess');
  });
});

describe('edad decidida por el modelo', () => {
  it('"demasiado pequeña" sin el servidor se corrige', () => {
    expect(
      reviewFinalText(
        'Carla es demasiado pequeña para esta clínica. Solo atendemos a peques de 0 a 4 años.',
        [],
        true,
      )?.code,
    ).toBe('age_guess');
  });
});

describe('mañana y tarde', () => {
  it('no deja llamar "de mañana" a horas de la tarde', () => {
    const t =
      'Para Nico tengo estos huecos por la mañana:\n- Martes 3 a las 16:30\n- Martes 3 a las 17:15';
    expect(reviewFinalText(t, [], true)?.code).toBe('wrong_daypart');
    expect(
      reviewFinalText('Por la mañana no hay; por la tarde tengo el martes a las 16:30.', [], true),
    ).toBeNull();
    expect(reviewFinalText('Por la mañana tengo el martes a las 10:30.', [], true)).toBeNull();
  });
});
