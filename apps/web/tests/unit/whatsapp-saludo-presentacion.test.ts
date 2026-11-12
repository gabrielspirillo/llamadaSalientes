import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { asksForAppointment, dropLeadingGreeting } from '@/lib/whatsapp/agent';

describe('presentación del asistente: no se come el principio de la frase', () => {
  it('los casos reales del 3 al 10/11', () => {
    expect(dropLeadingGreeting('Hola😊 ¿Te puedo ayudar?')).toBe('¿Te puedo ayudar?');
    expect(dropLeadingGreeting('Hola 😊 Gracias por tu mensaje, se lo pasamos a Raquel 😊')).toBe(
      'Gracias por tu mensaje, se lo pasamos a Raquel 😊',
    );
    expect(dropLeadingGreeting('Hola, ¿pedir cita para Valeria?')).toBe(
      '¿Pedir cita para Valeria?',
    );
    expect(dropLeadingGreeting('Hola😊 Hoy no hay hueco.')).toBe('Hoy no hay hueco.');
    expect(dropLeadingGreeting('Hola, sí estamos en horario de atención.')).toBe(
      'Sí estamos en horario de atención.',
    );
  });

  it('quita el nombre que va justo detrás del saludo', () => {
    expect(dropLeadingGreeting('Hola Laura 😊 ¿quieres que te busque hueco?')).toBe(
      '¿Quieres que te busque hueco?',
    );
    expect(dropLeadingGreeting('Buenos días, Alba 😊\nPara Gael tengo:')).toBe('Para Gael tengo:');
  });

  it('sin saludo, el texto queda igual', () => {
    expect(dropLeadingGreeting('¿Es para Sofía o para Emma?')).toBe('¿Es para Sofía o para Emma?');
    expect(dropLeadingGreeting('Holanda no')).toBe('Holanda no');
  });
});

describe('el saludo de "¿es la primera vez?" no sale para una cita que ya existe', () => {
  it('anular, cambiar o hablar de su cita no es pedir una nueva', () => {
    expect(asksForAppointment('Buenas. Quiero anular ella cita que tengo para el jueves.')).toBe(
      false,
    );
    expect(
      asksForAppointment('quiero cancelaros la cita para mañana porque la niña ha dejado de toser'),
    ).toBe(false);
    expect(asksForAppointment('¿Puedo cambiar la cita del martes?')).toBe(false);
    expect(asksForAppointment('Tenemos cita con Anxo hoy a las 16')).toBe(false);
  });

  it('pedir cita sí lo es', () => {
    expect(asksForAppointment('Hola, quería pedir cita para mi hijo')).toBe(true);
    expect(asksForAppointment('¿Tenéis algún hueco esta semana?')).toBe(true);
  });
});

describe('12/11: cita que ya tiene y agradecimientos', () => {
  it('"mi bebé tiene cita mañana" no es pedir cita nueva', () => {
    expect(
      asksForAppointment(
        'Hola buenas tardes mi bebé tiene cita mañana y quería hacer una pregunta, anda malito con fiebre',
      ),
    ).toBe(false);
    expect(asksForAppointment('Los niños tienen cita hoy, ¿pueden ir con mocos?')).toBe(false);
    expect(asksForAppointment('Quería pedir cita para mi hijo')).toBe(true);
  });

  it('"Perfecto muchas gracias" es sólo agradecer', async () => {
    const { isPureThanks } = await import('@/lib/whatsapp/agent');
    for (const t of ['Perfecto muchas gracias 🤗🤗', 'Vale, gracias', 'Genial gracias!']) {
      expect(isPureThanks(t)).toBe(true);
    }
    expect(isPureThanks('Perfecto, ¿y a qué hora es?')).toBe(false);
  });
});
