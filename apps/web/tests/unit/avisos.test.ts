import {
  duplicateGroups,
  duplicatesNotice,
  eventToNotice,
  sortNotices,
  tasksNotice,
} from '@/lib/notifications/model';
import { describe, expect, it } from 'vitest';

const NOW = new Date('2026-11-14T10:00:00Z');

describe('eventToNotice', () => {
  it('un recordatorio sin respuesta pide llamar, con el botón de llamar primero', () => {
    const n = eventToNotice({
      id: 'm1',
      eventKey: 'reminder.no_response',
      body: 'Sin confirmar — Paciente Uno\nCita: lunes 10:00\nTeléfono: +34600000000',
      contextPayload: {},
      actions: [
        { id: 'open', label: 'Ver recordatorios', href: '/dashboard/reminders' },
        { id: 'call', label: 'Llamar a Paciente Uno', href: 'tel:+34600000000' },
        { id: 'to-task', label: 'Crear tarea', action: 'message.to_task' },
      ],
      createdAt: NOW,
    });
    expect(n?.category).toBe('call');
    expect(n?.title).toBe('Sin confirmar — Paciente Uno');
    expect(n?.detail).toBe('Cita: lunes 10:00');
    expect(n?.actions[0]).toMatchObject({ kind: 'tel', primary: true });
    expect(n?.actions.map((a) => a.kind)).toEqual(['tel', 'link', 'to-task']);
    expect(n?.href).toBe('/dashboard/reminders');
    expect(n?.ref).toBe('im:m1');
  });

  it('un traspaso de WhatsApp abre la conversación', () => {
    const n = eventToNotice({
      id: 'm2',
      eventKey: 'wa.handoff',
      body: 'x',
      contextPayload: {
        title: 'WhatsApp pide humano — Familia',
        detail: 'Quiere hablar con Raquel',
      },
      actions: [{ id: 'open-wa', label: 'Tomar la conversación', href: '/dashboard/whatsapp/c1' }],
      createdAt: NOW,
    });
    expect(n?.category).toBe('person');
    expect(n?.actions[0]).toMatchObject({ kind: 'link', primary: true });
  });

  it('ignora eventos que no van a la campana', () => {
    expect(
      eventToNotice({
        id: 'm3',
        eventKey: 'analytics.daily_digest',
        body: 'Resumen',
        contextPayload: {},
        actions: [],
        createdAt: NOW,
      }),
    ).toBeNull();
  });
});

describe('duplicados', () => {
  it('agrupa por nombre sin tildes ni mayúsculas', () => {
    const groups = duplicateGroups([
      { id: 'a', name: 'Lucía Pérez' },
      { id: 'b', name: 'lucia  perez' },
      { id: 'c', name: 'Otro Niño' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('el aviso cambia de clave sólo si cambian las fichas', () => {
    const g = [
      [
        { id: 'a', name: 'X Y' },
        { id: 'b', name: 'X Y' },
      ],
    ];
    const one = duplicatesNotice(g, NOW);
    const two = duplicatesNotice(g, new Date(NOW.getTime() + 3600_000));
    expect(one?.ref).toBe(two?.ref);
    expect(duplicatesNotice([], NOW)).toBeNull();
  });
});

describe('tareas y orden', () => {
  it('sin tareas no hay aviso', () => {
    expect(tasksNotice({ today: 0, overdue: 0 }, '2026-11-14', NOW)).toBeNull();
    expect(tasksNotice({ today: 2, overdue: 1 }, '2026-11-14', NOW)?.detail).toBe(
      '2 para hoy · 1 vencida',
    );
  });

  it('lo que pide algo va antes que lo que informa', () => {
    const base = { detail: '', href: null, actions: [] };
    const sorted = sortNotices([
      { ...base, ref: 'a', category: 'agenda', title: 'a', createdAt: '2026-11-14T09:00:00Z' },
      { ...base, ref: 'b', category: 'call', title: 'b', createdAt: '2026-11-13T09:00:00Z' },
    ]);
    expect(sorted.map((n) => n.ref)).toEqual(['b', 'a']);
  });
});
