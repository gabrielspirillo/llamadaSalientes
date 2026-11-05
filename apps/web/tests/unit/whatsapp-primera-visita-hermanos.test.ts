import { describe, expect, it } from 'vitest';

import {
  answersFirstVisit,
  asksForGeneralInfo,
  conversationSaysFirstVisit,
  mentionsRegisteredChild,
  registeredChildNames,
  reviewFinalText,
} from '@/lib/whatsapp/agent/index';

const known =
  'Este teléfono es de Verónica. Niños registrados:\n- Darío Pérez Gil (2 años y 1 mes), patient_id=abc · YA VINO ANTES\nPregunta para cuál de ellos es la cita si hay más de uno.';

describe('hermano nuevo de una familia conocida', () => {
  it('saca los nombres de los niños en ficha', () => {
    expect(registeredChildNames(known)).toEqual(['Darío']);
    expect(registeredChildNames('Sin ficha')).toEqual([]);
  });

  it('pedir cita para otro niño NO se salta la pregunta de primera vez', () => {
    expect(mentionsRegisteredChild('Quería cita para mi hija Gala que tiene 5 meses', known)).toBe(
      false,
    );
    expect(mentionsRegisteredChild('Cita para Darío, por favor', known)).toBe(true);
    expect(mentionsRegisteredChild('cita para dario', known)).toBe(true);
  });

  it('"es la hermana" / "otro peque" cuenta como respuesta a la pregunta', () => {
    expect(answersFirstVisit('Es la hermana pequeña de Darío')).toBe(true);
    expect(answersFirstVisit('es otro hijo, nunca ha venido')).toBe(true);
    expect(answersFirstVisit('quiero cita para el jueves')).toBe(false);
  });

  it('si la conversación dice primera vez, check_availability va como primera visita', () => {
    expect(conversationSaysFirstVisit(['Quería cita', 'Sí, es la primera visita'])).toBe(true);
    expect(conversationSaysFirstVisit(['Cita para Gala, es la hermana de Darío'])).toBe(true);
    expect(conversationSaysFirstVisit(['Cita para Darío, ya hemos venido'])).toBe(false);
    expect(conversationSaysFirstVisit(['Quería cita para el martes'])).toBe(false);
  });
});

describe('información sobre las terapias', () => {
  it('detecta la petición de información general, no la de cita', () => {
    expect(asksForGeneralInfo('Hola qué tal!! Quería informarme sobre las terapias')).toBe(true);
    expect(asksForGeneralInfo('¿Cuánto cuesta la sesión?')).toBe(true);
    expect(asksForGeneralInfo('Quería cita para mi peque')).toBe(false);
    expect(asksForGeneralInfo('Hola')).toBe(false);
  });

  it('una lista de precios no pasa la revisión', () => {
    const r = reviewFinalText(
      'Claro😊, tenemos estas opciones:\n- Primera visita: 30 min, 45€\n- Visita recurrente: 30 min, 40€',
      [],
      true,
    );
    expect(r?.code).toBe('price_list');
    expect(
      reviewFinalText('Si necesitas información tienes todo en www.respinens.es 😊', [], true),
    ).toBeNull();
  });
});
