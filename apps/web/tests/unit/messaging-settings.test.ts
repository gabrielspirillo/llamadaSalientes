import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { isWithinDnd } from '@/lib/messaging/dnd';

/**
 * La franja de silencio es el caso donde una comparación ingenua falla: la que
 * la gente configura de verdad (21:00 → 08:00) cruza la medianoche, y con un
 * simple `from <= now && now < to` nunca silenciaría nada.
 */
describe('franja de no molestar', () => {
  it('silencia dentro de una franja diurna normal', () => {
    expect(isWithinDnd('13:00', '16:00', '14:30')).toBe(true);
    expect(isWithinDnd('13:00', '16:00', '13:00')).toBe(true);
  });

  it('no silencia fuera de una franja diurna', () => {
    expect(isWithinDnd('13:00', '16:00', '12:59')).toBe(false);
    expect(isWithinDnd('13:00', '16:00', '16:00')).toBe(false);
    expect(isWithinDnd('13:00', '16:00', '22:00')).toBe(false);
  });

  it('silencia de noche cuando la franja cruza la medianoche', () => {
    // El caso real: es el que rompe una comparación ingenua.
    expect(isWithinDnd('21:00', '08:00', '23:30')).toBe(true);
    expect(isWithinDnd('21:00', '08:00', '03:00')).toBe(true);
    expect(isWithinDnd('21:00', '08:00', '21:00')).toBe(true);
    expect(isWithinDnd('21:00', '08:00', '07:59')).toBe(true);
  });

  it('deja pasar el horario de trabajo con la franja nocturna puesta', () => {
    expect(isWithinDnd('21:00', '08:00', '08:00')).toBe(false);
    expect(isWithinDnd('21:00', '08:00', '12:00')).toBe(false);
    expect(isWithinDnd('21:00', '08:00', '20:59')).toBe(false);
  });

  it('sin franja configurada no silencia nada', () => {
    expect(isWithinDnd(null, null, '03:00')).toBe(false);
    expect(isWithinDnd('21:00', null, '03:00')).toBe(false);
    expect(isWithinDnd(null, '08:00', '03:00')).toBe(false);
  });

  it('una franja de ancho cero no silencia el día entero', () => {
    // Con from === to lo seguro es no silenciar: silenciar 24 h por un
    // descuido al configurar dejaría a alguien incomunicado sin saberlo.
    expect(isWithinDnd('09:00', '09:00', '09:00')).toBe(false);
    expect(isWithinDnd('09:00', '09:00', '18:00')).toBe(false);
  });
});

// Réplica del esquema de PATCH /api/messages/settings.
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa el formato HH:MM');
const patchSchema = z.object({
  sound: z.boolean().optional(),
  desktopPush: z.boolean().optional(),
  dndFrom: hhmm.nullish(),
  dndTo: hhmm.nullish(),
  escalateMentionsAfterMinutes: z.number().int().min(0).max(1440).optional(),
  statusEmoji: z.string().trim().max(8).nullish(),
  statusText: z.string().trim().max(80).nullish(),
  statusUntil: z.string().datetime({ offset: true }).nullish(),
});

describe('cuerpo de las preferencias', () => {
  it('acepta apagar el escalado', () => {
    expect(patchSchema.safeParse({ escalateMentionsAfterMinutes: 0 }).success).toBe(true);
  });

  it('acepta poner y quitar la franja', () => {
    expect(patchSchema.safeParse({ dndFrom: '21:00', dndTo: '08:00' }).success).toBe(true);
    // Quitarla manda null explícito: por eso es `nullish` y no `optional`.
    expect(patchSchema.safeParse({ dndFrom: null, dndTo: null }).success).toBe(true);
  });

  it('rechaza una hora mal escrita', () => {
    expect(patchSchema.safeParse({ dndFrom: '25:00', dndTo: '08:00' }).success).toBe(false);
    expect(patchSchema.safeParse({ dndFrom: '9:00', dndTo: '08:00' }).success).toBe(false);
  });

  it('rechaza un margen absurdo', () => {
    expect(patchSchema.safeParse({ escalateMentionsAfterMinutes: -5 }).success).toBe(false);
    expect(patchSchema.safeParse({ escalateMentionsAfterMinutes: 5000 }).success).toBe(false);
  });
});
