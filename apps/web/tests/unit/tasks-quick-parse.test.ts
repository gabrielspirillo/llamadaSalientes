import { describe, expect, it } from 'vitest';

import { parseQuickTask } from '@/lib/tasks/quick-parse';

// Referencia fija: martes 1 de septiembre de 2026, 09:00 hora local.
const NOW = new Date(2026, 8, 1, 9, 0, 0, 0);

describe('parseQuickTask', () => {
  it('deja el título limpio de los modificadores', () => {
    const r = parseQuickTask('Llamar a María mañana 10:30 #paciente !alta @lucia', NOW);
    expect(r.title).toBe('Llamar a María');
    expect(r.category).toBe('PATIENT');
    expect(r.priority).toBe('HIGH');
    expect(r.assigneeHints).toEqual(['lucia']);
  });

  it('resuelve "mañana" con la hora indicada', () => {
    const r = parseQuickTask('Confirmar cita mañana 10:30', NOW);
    expect(r.dueAt?.getDate()).toBe(2);
    expect(r.dueAt?.getHours()).toBe(10);
    expect(r.dueAt?.getMinutes()).toBe(30);
    expect(r.dueAllDay).toBe(false);
  });

  it('sin hora marca el día completo y vence al final de la jornada', () => {
    const r = parseQuickTask('Pedir material hoy', NOW);
    expect(r.dueAllDay).toBe(true);
    expect(r.dueAt?.getDate()).toBe(1);
    expect(r.dueAt?.getHours()).toBe(18);
  });

  it('una hora ya pasada hoy se entiende como mañana', () => {
    const late = new Date(2026, 8, 1, 18, 0, 0, 0);
    const r = parseQuickTask('Arqueo de caja 9:00', late);
    expect(r.dueAt?.getDate()).toBe(2);
    expect(r.dueAt?.getHours()).toBe(9);
  });

  it('no confunde un número suelto con una hora', () => {
    const r = parseQuickTask('Llamar al 20 de la lista', NOW);
    expect(r.dueAt).toBeNull();
    expect(r.title).toBe('Llamar al 20 de la lista');
  });

  it('interpreta el próximo día de la semana', () => {
    // NOW es martes; "lunes" es el de la semana siguiente (día 7).
    const r = parseQuickTask('Control biológico el lunes', NOW);
    expect(r.dueAt?.getDate()).toBe(7);
  });

  it('acepta fechas dd/mm y las lleva al año que viene si ya pasaron', () => {
    const r = parseQuickTask('Revisión UTPR 15/02', NOW);
    expect(r.dueAt?.getMonth()).toBe(1);
    expect(r.dueAt?.getFullYear()).toBe(2027);
  });

  it('los bangs sin palabra escalan la prioridad', () => {
    expect(parseQuickTask('Urgencia !!!', NOW).priority).toBe('URGENT');
    expect(parseQuickTask('Revisar !!', NOW).priority).toBe('HIGH');
  });

  it('las etiquetas que no son categoría quedan como labels', () => {
    const r = parseQuickTask('Pedido #proveedor-x #admin', NOW);
    expect(r.category).toBe('ADMIN');
    expect(r.labels).toEqual(['proveedor-x']);
  });

  it('"en 3 días" suma días', () => {
    const r = parseQuickTask('Seguimiento en 3 días', NOW);
    expect(r.dueAt?.getDate()).toBe(4);
  });
});
