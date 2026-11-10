import { describe, expect, it } from 'vitest';

import { isOfferHour, parseAdvanceReply } from '@/lib/agenda/advance-offers';

describe('respuesta a la oferta de adelanto', () => {
  it('lee el número o el sí/no de la familia', () => {
    expect(parseAdvanceReply('1')).toBe('yes');
    expect(parseAdvanceReply('Sí, por favor')).toBe('yes');
    expect(parseAdvanceReply('vale!')).toBe('yes');
    expect(parseAdvanceReply('2')).toBe('no');
    expect(parseAdvanceReply('No, mejor la dejamos')).toBe('no');
    expect(parseAdvanceReply('no gracias')).toBe('no');
  });

  it('deja pasar al asistente lo que no es una respuesta', () => {
    expect(parseAdvanceReply('¿A qué hora era?')).toBeNull();
    expect(parseAdvanceReply('')).toBeNull();
    expect(
      parseAdvanceReply('hola quería pedir cita para mi hijo mayor que tiene tos desde hace días'),
    ).toBeNull();
  });
});

describe('plazo para contestar la oferta', () => {
  it('dice los 20 minutos con las palabras de la clínica o, si el hueco está cerca, la hora límite', async () => {
    const { validityLine } = await import('@/lib/agenda/advance-offers');
    const now = new Date('2026-11-05T15:00:00Z');
    expect(validityLine(now, new Date(now.getTime() + 20 * 60_000), 'Europe/Madrid')).toBe(
      'Si en un plazo de 20 minutos no tenemos respuesta, se ofrecerá a otro peque.',
    );
    expect(validityLine(now, new Date(now.getTime() + 12 * 60_000), 'Europe/Madrid')).toBe(
      'Si antes de las 16:12 no tenemos respuesta, se ofrecerá a otro peque.',
    );
  });
});

describe('adelanto aceptado para hoy', () => {
  it('añade las indicaciones de la clínica sin el "nos vemos" del guion', async () => {
    const { dayOfReminderTailFromScript } = await import('@/lib/agenda/advance-offers');
    const script =
      'Perfecto 😊 Nos vemos {{cuando}}.\n\nRecuerda:\n- 🍼🚫 2 HORAS DE AYUNO\n- 🕑 PUNTUALIDAD\n\nMuchas gracias✨';
    expect(dayOfReminderTailFromScript(script)).toBe(
      'Recuerda:\n- 🍼🚫 2 HORAS DE AYUNO\n- 🕑 PUNTUALIDAD\n\nMuchas gracias✨',
    );
    expect(dayOfReminderTailFromScript('Sólo una línea')).toBe('');
    expect(dayOfReminderTailFromScript(null)).toBe('');
  });
});

describe('respuesta citando otro mensaje (6/11)', () => {
  it('un "sí gracias" a la confirmación de la cita no acepta la oferta', async () => {
    const { quotedTextFrom, quoteIsForOffer } = await import('@/lib/agenda/advance-offers');
    const reply = {
      message: { conversation: 'Si gracias' },
      contextInfo: { quotedMessage: { conversation: 'Ya tienes la cita reservada para Leo' } },
    };
    expect(quoteIsForOffer(quotedTextFrom(reply))).toBe(false);
    const toOffer = {
      message: {
        extendedTextMessage: {
          text: '1',
          contextInfo: {
            quotedMessage: { conversation: 'Hola… Se ha liberado un hueco miércoles a las 18:00' },
          },
        },
      },
    };
    expect(quoteIsForOffer(quotedTextFrom(toOffer))).toBe(true);
    expect(quoteIsForOffer(quotedTextFrom({ message: { conversation: 'Sí' } }))).toBe(true);
  });
});

describe('el mensaje citado sobrevive al esquema de Evolution', () => {
  it('zod conserva contextInfo.quotedMessage (6/11: se descartaba y la protección no actuaba)', async () => {
    const { evolutionMessagesUpsertSchema } = await import('@/lib/whatsapp/inbound');
    const { quotedTextFrom, quoteIsForOffer } = await import('@/lib/agenda/advance-offers');
    const parsed = evolutionMessagesUpsertSchema.safeParse({
      event: 'messages.upsert',
      instance: 'x',
      data: {
        key: { remoteJid: '34600000000@s.whatsapp.net', fromMe: false, id: 'ABC' },
        message: {
          extendedTextMessage: {
            text: 'Si gracias',
            contextInfo: {
              stanzaId: 'XYZ',
              quotedMessage: { conversation: 'Ya tienes la cita reservada para Leo' },
            },
          },
        },
      },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(quotedTextFrom(parsed.data.data)).toBe('Ya tienes la cita reservada para Leo');
    expect(quoteIsForOffer(quotedTextFrom(parsed.data.data))).toBe(false);
  });
});

describe('horario de las ofertas: de 08:00 a 23:00 (clínica, 9/11)', () => {
  const madrid = (hh: number, mm = 0) => new Date(Date.UTC(2026, 10, 10, hh - 1, mm));
  it('de noche no; desde las 8 sí', () => {
    expect(isOfferHour(madrid(7, 59), 'Europe/Madrid')).toBe(false);
    expect(isOfferHour(madrid(8, 0), 'Europe/Madrid')).toBe(true);
    expect(isOfferHour(madrid(15, 30), 'Europe/Madrid')).toBe(true);
  });
  it('la última sale con el plazo de 20 minutos terminando antes de las 23:00', () => {
    expect(isOfferHour(madrid(22, 40), 'Europe/Madrid')).toBe(true);
    expect(isOfferHour(madrid(22, 41), 'Europe/Madrid')).toBe(false);
    expect(isOfferHour(madrid(23, 30), 'Europe/Madrid')).toBe(false);
  });
});
