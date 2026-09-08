import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * Lo que dispara una cita de la agenda de la plataforma.
 *
 * La agenda era una isla: la cita se guardaba y ahí acababa todo. Los
 * recordatorios, la lista de espera, las tareas automáticas, los avisos del
 * chat interno y las métricas colgaban del webhook de GoHighLevel, así que una
 * clínica sin CRM tenía agenda y nada más.
 *
 * Aquí se fija que una cita propia dispara lo mismo, y —tan importante como
 * eso— que lo dispara por TRANSICIÓN y una sola vez.
 */

const spies = vi.hoisted(() => ({
  upsertCache: vi.fn(async () => undefined),
  deleteCache: vi.fn(async () => undefined),
  recordCancelledSlot: vi.fn(async () => ({ id: 'slot-1' })),
  tryAttribute: vi.fn(async () => null),
  materialize: vi.fn(async () => ({ scheduled: 1, skipped: [] })),
  cancelReminders: vi.fn(async () => ({ cancelled: 1 })),
  onCancelled: vi.fn(async () => undefined),
  onNoShow: vi.fn(async () => undefined),
  onCompleted: vi.fn(async () => undefined),
  postCancelled: vi.fn(async () => undefined),
  postNoShow: vi.fn(async () => undefined),
  enqueueOffer: vi.fn(async () => ({ ok: true })),
  autoEnqueue: vi.fn(async () => ({ ok: true, entryId: 'e-1' })),
}));

vi.mock('@/lib/appointments/cache', () => ({
  upsertInternalAppointmentCache: spies.upsertCache,
  deleteAppointmentCache: spies.deleteCache,
}));
vi.mock('@/lib/analytics/slot-attribution', () => ({
  recordCancelledSlot: spies.recordCancelledSlot,
  tryAttributeNewAppointment: spies.tryAttribute,
}));
vi.mock('@/lib/reminders/materialize', () => ({ materializeReminders: spies.materialize }));
vi.mock('@/lib/reminders/cancel', () => ({ cancelReminders: spies.cancelReminders }));
vi.mock('@/lib/tasks/hooks', () => ({
  onAppointmentCancelled: spies.onCancelled,
  onAppointmentNoShow: spies.onNoShow,
  onAppointmentCompleted: spies.onCompleted,
}));
vi.mock('@/lib/messaging/bot', () => ({
  postAppointmentCancelled: spies.postCancelled,
  postAppointmentNoShow: spies.postNoShow,
}));
vi.mock('@/lib/waitlist/engine', () => ({
  enqueueOfferForCancelledSlot: spies.enqueueOffer,
  autoEnqueueOnNewAppointment: spies.autoEnqueue,
}));
vi.mock('@/lib/db/client', () => {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => Promise.resolve([{ name: 'Limpieza dental' }]);
  return { db: { select: () => chain } };
});

import {
  type AgendaAppointmentRow,
  cacheStatusFor,
  syncAppointmentEffects,
} from '@/lib/agenda/sync';

const PROF = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function cita(over: Partial<AgendaAppointmentRow> = {}): AgendaAppointmentRow {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    tenantId: 'tenant-1',
    professionalId: PROF,
    treatmentId: 'treat-1',
    patientKey: 'tel:+34600111222',
    patientName: 'Adrián Ortiz',
    patientPhone: '+34600111222',
    patientEmail: null,
    ghlContactId: null,
    startsAt: new Date('2026-10-01T09:00:00.000Z'),
    endsAt: new Date('2026-10-01T09:45:00.000Z'),
    status: 'SCHEDULED',
    source: 'PANEL',
    title: null,
    notes: null,
    cancelReason: null,
    createdByUserId: null,
    dedupeKey: null,
    createdAt: new Date('2026-09-01T09:00:00.000Z'),
    updatedAt: new Date('2026-09-01T09:00:00.000Z'),
    ...over,
  } as AgendaAppointmentRow;
}

beforeEach(() => {
  for (const s of Object.values(spies)) s.mockClear();
});

describe('el estado que se escribe en la caché', () => {
  it('usa el vocabulario que cuentan las métricas', () => {
    // `getNoShowStats` cuenta 'completed' y 'no_show'; escribir 'showed' o
    // 'noshow' dejaría la tasa de ausencias en cero para siempre.
    expect(cacheStatusFor('COMPLETED')).toBe('completed');
    expect(cacheStatusFor('NO_SHOW')).toBe('no_show');
    expect(cacheStatusFor('CANCELLED')).toBe('cancelled');
    for (const s of ['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_PROGRESS'] as const) {
      expect(cacheStatusFor(s)).toBe('confirmed');
    }
  });
});

describe('cita nueva', () => {
  it('la refleja, le programa los recordatorios y la ofrece a la lista de espera', async () => {
    await syncAppointmentEffects({ appointment: cita(), change: 'created' });

    expect(spies.upsertCache).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: '11111111-2222-3333-4444-555555555555',
        contactRef: 'tel:+34600111222',
        calendarRef: `prof:${PROF}`,
        status: 'confirmed',
      }),
    );
    expect(spies.materialize).toHaveBeenCalledWith(expect.objectContaining({ reason: 'create' }));
    expect(spies.tryAttribute).toHaveBeenCalled();
    expect(spies.autoEnqueue).toHaveBeenCalled();
    // Nada de cancelación.
    expect(spies.onCancelled).not.toHaveBeenCalled();
    expect(spies.deleteCache).not.toHaveBeenCalled();
  });

  it('con paciente del CRM, la identidad compartida es la del CRM', async () => {
    await syncAppointmentEffects({
      appointment: cita({ ghlContactId: 'W5CUSlYRHfeubqP8j29P' }),
      change: 'created',
    });
    expect(spies.upsertCache).toHaveBeenCalledWith(
      expect.objectContaining({ contactRef: 'W5CUSlYRHfeubqP8j29P' }),
    );
  });
});

describe('cita cancelada', () => {
  it('avisa al equipo, libera el hueco y cancela los recordatorios', async () => {
    await syncAppointmentEffects({
      appointment: cita({ status: 'CANCELLED' }),
      previousStatus: 'SCHEDULED',
      change: 'updated',
    });

    expect(spies.deleteCache).toHaveBeenCalled();
    expect(spies.cancelReminders).toHaveBeenCalled();
    expect(spies.onCancelled).toHaveBeenCalled();
    expect(spies.postCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ patientName: 'Adrián Ortiz', phone: '+34600111222' }),
    );
    expect(spies.recordCancelledSlot).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: `prof:${PROF}` }),
    );
    expect(spies.enqueueOffer).toHaveBeenCalledWith('tenant-1', 'slot-1');
    // No se le programan recordatorios a una cita cancelada.
    expect(spies.materialize).not.toHaveBeenCalled();
  });

  it('guardar algo en una cita ya cancelada no la vuelve a anunciar', async () => {
    // Se dispara por transición: sin esto, editar la nota de una cita cancelada
    // repetiría la tarjeta en el chat y reabriría la oferta al mismo paciente.
    await syncAppointmentEffects({
      appointment: cita({ status: 'CANCELLED' }),
      previousStatus: 'CANCELLED',
      change: 'updated',
    });

    expect(spies.onCancelled).not.toHaveBeenCalled();
    expect(spies.postCancelled).not.toHaveBeenCalled();
    expect(spies.recordCancelledSlot).not.toHaveBeenCalled();
  });
});

describe('otras transiciones', () => {
  it('no asistió: tarea y aviso, sin tocar la lista de espera', async () => {
    await syncAppointmentEffects({
      appointment: cita({ status: 'NO_SHOW' }),
      previousStatus: 'CONFIRMED',
      change: 'updated',
    });

    expect(spies.onNoShow).toHaveBeenCalled();
    expect(spies.postNoShow).toHaveBeenCalled();
    expect(spies.cancelReminders).toHaveBeenCalled();
    expect(spies.recordCancelledSlot).not.toHaveBeenCalled();
  });

  it('completada: dispara el seguimiento post-tratamiento', async () => {
    await syncAppointmentEffects({
      appointment: cita({ status: 'COMPLETED' }),
      previousStatus: 'ARRIVED',
      change: 'updated',
    });
    expect(spies.onCompleted).toHaveBeenCalled();
  });

  it('mover la cita reprograma sus recordatorios', async () => {
    // Si no, el paciente recibe el aviso de la hora vieja.
    await syncAppointmentEffects({
      appointment: cita(),
      previousStatus: 'SCHEDULED',
      change: 'rescheduled',
    });
    expect(spies.materialize).toHaveBeenCalledWith(expect.objectContaining({ reason: 'update' }));
  });
});

describe('nunca tumba la cita', () => {
  it('un fallo de cualquier efecto no se propaga', async () => {
    // La cita ya está confirmada con el paciente: no se cae porque no se
    // pudiera programar un recordatorio o publicar un aviso.
    spies.materialize.mockRejectedValueOnce(new Error('redis caído'));
    spies.upsertCache.mockRejectedValueOnce(new Error('base caída'));

    await expect(
      syncAppointmentEffects({ appointment: cita(), change: 'created' }),
    ).resolves.toBeUndefined();
  });
});

describe('los recordatorios no se recalculan por cualquier cosa', () => {
  it('editar una cita sin moverla los deja en paz', async () => {
    // `materializeReminders` con motivo `update` empieza cancelando los que
    // había: corregirle el apellido al paciente tiraría los recordatorios
    // vivos y volvería a calcularlos, con el riesgo de perder alguno por
    // horario de silencio.
    await syncAppointmentEffects({
      appointment: cita({ patientName: 'Adrián Ortiz Pérez' }),
      previousStatus: 'SCHEDULED',
      change: 'updated',
    });

    expect(spies.materialize).not.toHaveBeenCalled();
    expect(spies.cancelReminders).not.toHaveBeenCalled();
    // El espejo sí se actualiza: los datos de la cita cambiaron.
    expect(spies.upsertCache).toHaveBeenCalled();
  });

  it('revivir una cita cancelada sí se los devuelve', async () => {
    await syncAppointmentEffects({
      appointment: cita({ status: 'SCHEDULED' }),
      previousStatus: 'CANCELLED',
      change: 'updated',
    });
    expect(spies.materialize).toHaveBeenCalledWith(expect.objectContaining({ reason: 'update' }));
  });
});
