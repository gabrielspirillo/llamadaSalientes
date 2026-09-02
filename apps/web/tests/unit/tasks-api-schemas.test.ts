/**
 * QA-API · Contratos de entrada del módulo Tareas.
 *
 * Los schemas de `lib/tasks/api.ts` son puros: se pueden ejercitar sin Next ni
 * base de datos. Estos tests documentan qué acepta y qué rechaza cada endpoint
 * en su frontera, incluidos los huecos encontrados en la auditoría (marcados
 * con HALLAZGO).
 */
import { describe, expect, it, vi } from 'vitest';

// El módulo arrastra `lib/db/client` (que valida env al importarse) solo por
// las clases de error. Lo cortamos acá: estos tests no tocan la base.
vi.mock('@/lib/db/client', () => ({ db: {} }));

import {
  automationSchema,
  createTaskSchema,
  dueAtSchema,
  reorderSchema,
  templateSchema,
  updateTaskSchema,
} from '@/lib/tasks/api';

const UUID = '11111111-2222-4333-8444-555555555555';

describe('createTaskSchema', () => {
  it('acepta el payload mínimo que manda QuickAdd', () => {
    const r = createTaskSchema.safeParse({ title: 'Llamar a Marta' });
    expect(r.success).toBe(true);
  });

  it('recorta el título y rechaza el vacío o solo espacios', () => {
    expect(createTaskSchema.parse({ title: '  Llamar  ' }).title).toBe('Llamar');
    expect(createTaskSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: '' }).success).toBe(false);
    expect(createTaskSchema.safeParse({}).success).toBe(false);
  });

  it('corta el título en 300 y la descripción en 4000', () => {
    expect(createTaskSchema.safeParse({ title: 'a'.repeat(300) }).success).toBe(true);
    expect(createTaskSchema.safeParse({ title: 'a'.repeat(301) }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'ok', description: 'a'.repeat(4001) }).success).toBe(
      false,
    );
  });

  it('exige enums conocidos en category/priority/status', () => {
    expect(createTaskSchema.safeParse({ title: 'ok', category: 'PATIENT' }).success).toBe(true);
    expect(createTaskSchema.safeParse({ title: 'ok', category: 'OTRA' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'ok', status: 'ARCHIVED' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'ok', priority: 'CRITICAL' }).success).toBe(false);
  });

  it('dueAt: acepta ISO con Z u offset y null; rechaza fecha suelta o sin zona', () => {
    expect(dueAtSchema.parse('2026-09-10T10:00:00.000Z')).toBeInstanceOf(Date);
    expect(dueAtSchema.parse('2026-09-10T10:00:00+02:00')).toBeInstanceOf(Date);
    expect(dueAtSchema.parse(null)).toBeNull();
    expect(dueAtSchema.safeParse('2026-09-10T10:00:00').success).toBe(false);
    expect(dueAtSchema.safeParse('2026-09-10').success).toBe(false);
    expect(dueAtSchema.safeParse(1_700_000_000_000).success).toBe(false);
  });

  it('limita labels (12 × 40) y assigneeUserIds (10 uuid)', () => {
    expect(createTaskSchema.safeParse({ title: 'ok', labels: Array(12).fill('x') }).success).toBe(
      true,
    );
    expect(createTaskSchema.safeParse({ title: 'ok', labels: Array(13).fill('x') }).success).toBe(
      false,
    );
    expect(createTaskSchema.safeParse({ title: 'ok', labels: ['a'.repeat(41)] }).success).toBe(
      false,
    );
    expect(
      createTaskSchema.safeParse({ title: 'ok', assigneeUserIds: ['no-es-uuid'] }).success,
    ).toBe(false);
    expect(
      createTaskSchema.safeParse({ title: 'ok', assigneeUserIds: Array(11).fill(UUID) }).success,
    ).toBe(false);
  });

  it('checklist admite hasta 50 ítems de 300 caracteres', () => {
    expect(
      createTaskSchema.safeParse({ title: 'ok', checklist: Array(50).fill('paso') }).success,
    ).toBe(true);
    expect(
      createTaskSchema.safeParse({ title: 'ok', checklist: Array(51).fill('paso') }).success,
    ).toBe(false);
  });

  it('HALLAZGO: descarta en silencio los campos que no controla el cliente', () => {
    // Sin `.strict()`, mandar source/dedupeKey/templateId no da 400: se ignoran.
    // Bien para la seguridad (no se pueden falsificar rutinas), mal para el
    // diagnóstico: el cliente cree que los mandó.
    const r = createTaskSchema.parse({
      title: 'ok',
      source: 'ROUTINE',
      dedupeKey: 'routine:x:2026-09-02',
      templateId: UUID,
      tenantId: 'otro-tenant',
    } as Record<string, unknown>);
    expect(r).not.toHaveProperty('source');
    expect(r).not.toHaveProperty('dedupeKey');
    expect(r).not.toHaveProperty('tenantId');
  });

  it('HALLAZGO: permite nacer en DONE con requiresEvidence y sin evidencia', () => {
    // createTask() no valida evidencia (solo updateTask y reorderColumn lo hacen),
    // así que este payload crea una tarea cerrada que jamás pasó por el control.
    const r = createTaskSchema.safeParse({
      title: 'Ciclo autoclave',
      status: 'DONE',
      requiresEvidence: true,
    });
    expect(r.success).toBe(true);
  });
});

describe('updateTaskSchema', () => {
  it('todos los campos son opcionales: un PATCH vacío es válido', () => {
    expect(updateTaskSchema.safeParse({}).success).toBe(true);
  });

  it('acepta null explícito en description, evidenceNote y dueAt', () => {
    const r = updateTaskSchema.parse({ description: null, evidenceNote: null, dueAt: null });
    expect(r.description).toBeNull();
    expect(r.evidenceNote).toBeNull();
    expect(r.dueAt).toBeNull();
  });

  it('HALLAZGO: deja apagar requiresEvidence en el mismo PATCH que cierra', () => {
    // updateTask() evalúa el gate con el requiresEvidence entrante, no con el
    // guardado: este payload cierra una rutina de esterilización sin nota.
    const r = updateTaskSchema.safeParse({ status: 'DONE', requiresEvidence: false });
    expect(r.success).toBe(true);
  });

  it('HALLAZGO: deja borrar la nota de evidencia de una tarea ya cerrada', () => {
    expect(updateTaskSchema.safeParse({ evidenceNote: null }).success).toBe(true);
  });

  it('no deja tocar source, boardPosition ni completedByUserId', () => {
    const r = updateTaskSchema.parse({
      source: 'MANUAL',
      boardPosition: 1,
      completedByUserId: UUID,
    } as Record<string, unknown>);
    expect(Object.keys(r)).toHaveLength(0);
  });
});

describe('reorderSchema', () => {
  it('exige un status válido y uuids', () => {
    expect(reorderSchema.safeParse({ status: 'TODO', orderedIds: [UUID] }).success).toBe(true);
    expect(reorderSchema.safeParse({ status: 'HECHO', orderedIds: [] }).success).toBe(false);
    expect(reorderSchema.safeParse({ status: 'TODO', orderedIds: ['x'] }).success).toBe(false);
  });

  it('HALLAZGO: acepta lista vacía y duplicados', () => {
    // Vacío = no-op silencioso (200 ok). Duplicados = la misma tarea se
    // reposiciona dos veces; gana la última posición del bucle.
    expect(reorderSchema.safeParse({ status: 'TODO', orderedIds: [] }).success).toBe(true);
    expect(
      reorderSchema.safeParse({ status: 'TODO', orderedIds: [UUID, UUID, UUID] }).success,
    ).toBe(true);
  });

  it('tope de 400 ids por request', () => {
    expect(
      reorderSchema.safeParse({ status: 'TODO', orderedIds: Array(400).fill(UUID) }).success,
    ).toBe(true);
    expect(
      reorderSchema.safeParse({ status: 'TODO', orderedIds: Array(401).fill(UUID) }).success,
    ).toBe(false);
  });
});

describe('templateSchema', () => {
  it('exige nombre y valida los rangos de recurrencia', () => {
    expect(templateSchema.safeParse({ name: 'Apertura' }).success).toBe(true);
    expect(templateSchema.safeParse({}).success).toBe(false);
    expect(templateSchema.safeParse({ name: 'x', recurrenceInterval: 0 }).success).toBe(false);
    expect(templateSchema.safeParse({ name: 'x', recurrenceInterval: 53 }).success).toBe(false);
    expect(templateSchema.safeParse({ name: 'x', recurrenceWeekdays: [0] }).success).toBe(false);
    expect(templateSchema.safeParse({ name: 'x', recurrenceWeekdays: [8] }).success).toBe(false);
    expect(templateSchema.safeParse({ name: 'x', recurrenceMonthDay: 29 }).success).toBe(false);
    expect(templateSchema.safeParse({ name: 'x', recurrenceMonth: 13 }).success).toBe(false);
    expect(templateSchema.safeParse({ name: 'x', leadDays: 61 }).success).toBe(false);
  });

  it('HALLAZGO: dueTime solo valida la forma, no la hora', () => {
    // '99:99' pasa el regex. parseTimeOfDay() lo recorta a 23:59 al
    // materializar, pero la UI de rutinas muestra la basura tal cual.
    expect(templateSchema.safeParse({ name: 'x', dueTime: '99:99' }).success).toBe(true);
    expect(templateSchema.safeParse({ name: 'x', dueTime: '7:5' }).success).toBe(false);
    expect(templateSchema.safeParse({ name: 'x', dueTime: '09:00:00' }).success).toBe(false);
  });

  it('HALLAZGO: recurrenceWeekdays admite duplicados', () => {
    expect(
      templateSchema.safeParse({ name: 'x', recurrenceWeekdays: [1, 1, 1, 1, 1, 1, 1] }).success,
    ).toBe(true);
  });

  it('el PATCH usa .partial(): un cuerpo vacío es válido y no cambia nada', () => {
    expect(templateSchema.partial().safeParse({}).success).toBe(true);
  });

  it('HALLAZGO: .partial() deja mandar name: undefined y no rompe, pero {} tampoco avisa', () => {
    const r = templateSchema.partial().parse({ name: undefined });
    expect(r.name).toBeUndefined();
  });

  it('defaultAssigneeUserId exige uuid (pero nadie comprueba que sea de la clínica)', () => {
    expect(templateSchema.safeParse({ name: 'x', defaultAssigneeUserId: 'pepe' }).success).toBe(
      false,
    );
    expect(templateSchema.safeParse({ name: 'x', defaultAssigneeUserId: UUID }).success).toBe(true);
  });
});

describe('automationSchema', () => {
  it('no permite cambiar el trigger de la regla', () => {
    const r = automationSchema.parse({ trigger: 'MISSED_CALL', enabled: false } as Record<
      string,
      unknown
    >);
    expect(r).not.toHaveProperty('trigger');
    expect(r.enabled).toBe(false);
  });

  it('acota el SLA entre 5 minutos y 14 días', () => {
    expect(automationSchema.safeParse({ dueOffsetMinutes: 4 }).success).toBe(false);
    expect(automationSchema.safeParse({ dueOffsetMinutes: 5 }).success).toBe(true);
    expect(automationSchema.safeParse({ dueOffsetMinutes: 20_160 }).success).toBe(true);
    expect(automationSchema.safeParse({ dueOffsetMinutes: 20_161 }).success).toBe(false);
    expect(automationSchema.safeParse({ dueOffsetMinutes: 1.5 }).success).toBe(false);
  });

  it('HALLAZGO: params es un jsonb sin techo ni forma', () => {
    // z.record(z.unknown()) acepta cualquier objeto: no hay límite de tamaño ni
    // validación de las claves que el motor sí lee (p.ej. inactiveMonths).
    const gordo = {
      basura: 'x'.repeat(200_000),
      inactiveMonths: 'doce',
      anidado: { a: { b: {} } },
    };
    expect(automationSchema.safeParse({ params: gordo }).success).toBe(true);
  });

  it('titleTemplate no puede quedar vacío', () => {
    expect(automationSchema.safeParse({ titleTemplate: '   ' }).success).toBe(false);
    expect(automationSchema.safeParse({ titleTemplate: 'Llamar a {{patientName}}' }).success).toBe(
      true,
    );
  });
});
