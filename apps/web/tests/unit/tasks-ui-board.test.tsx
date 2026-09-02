// Bloque 1 — Tablero: columnas, contadores, contenido de la card y apertura del detalle.

import { KanbanBoard } from '@/components/tasks/KanbanBoard';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LUCIA, MARTA, MEMBERS, task } from './tasks-ui-fixtures';

afterEach(cleanup);

const NOW = new Date('2026-09-02T10:00:00.000Z');

function renderBoard(over: Partial<Parameters<typeof KanbanBoard>[0]> = {}) {
  const onOpen = vi.fn();
  const onReorder = vi.fn();
  const onQuickAdd = vi.fn();
  const tasks = over.tasks ?? [
    task({ id: 'a', title: 'Abrir gabinete', status: 'TODO' }),
    task({ id: 'b', title: 'Llamar a paciente', status: 'TODO' }),
    task({ id: 'c', title: 'Cuadrar caja', status: 'IN_PROGRESS' }),
    task({ id: 'd', title: 'Revisar RGPD', status: 'IN_REVIEW' }),
    task({ id: 'e', title: 'Esterilizar', status: 'DONE' }),
  ];
  render(
    <KanbanBoard
      tasks={tasks}
      members={MEMBERS}
      now={NOW}
      canEdit
      onOpen={onOpen}
      onReorder={onReorder}
      onQuickAdd={onQuickAdd}
      {...over}
    />,
  );
  return { onOpen, onReorder, onQuickAdd };
}

function column(label: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: label, level: 2 });
  const section = heading.closest('section');
  if (!section) throw new Error(`sin <section> para la columna ${label}`);
  return section as HTMLElement;
}

describe('KanbanBoard — columnas y contadores', () => {
  it('muestra las 4 columnas con sus etiquetas', () => {
    renderBoard();
    for (const label of ['Por hacer', 'En curso', 'En revisión', 'Hecho']) {
      expect(screen.getByRole('heading', { name: label, level: 2 })).toBeTruthy();
    }
  });

  it('coloca cada tarea en la columna de su estado', () => {
    renderBoard();
    expect(within(column('Por hacer')).getByText('Abrir gabinete')).toBeTruthy();
    expect(within(column('Por hacer')).getByText('Llamar a paciente')).toBeTruthy();
    expect(within(column('En curso')).getByText('Cuadrar caja')).toBeTruthy();
    expect(within(column('En revisión')).getByText('Revisar RGPD')).toBeTruthy();
    expect(within(column('Hecho')).getByText('Esterilizar')).toBeTruthy();
    // y no aparecen donde no toca
    expect(within(column('En curso')).queryByText('Abrir gabinete')).toBeNull();
  });

  it('el contador de cada columna coincide con las tarjetas que contiene', () => {
    renderBoard();
    const counts: Record<string, string> = {
      'Por hacer': '2',
      'En curso': '1',
      'En revisión': '1',
      Hecho: '1',
    };
    for (const [label, expected] of Object.entries(counts)) {
      const header = column(label).querySelector('header');
      expect(header?.textContent).toContain(expected);
      expect(within(column(label)).getAllByRole('article').length).toBe(Number(expected));
    }
  });

  it('columna vacía muestra su mensaje', () => {
    renderBoard({ tasks: [] });
    expect(screen.getByText('Sin pendientes aquí')).toBeTruthy();
    expect(screen.getByText('Alguien ya lo está haciendo')).toBeTruthy();
  });
});

describe('TaskCard — contenido', () => {
  it('muestra categoría, prioridad, paciente, checklist, avatares y vencimiento', () => {
    renderBoard({
      tasks: [
        task({
          id: 'x',
          title: 'Devolver llamada',
          category: 'PATIENT',
          priority: 'URGENT',
          patientName: 'María Gómez',
          patientPhone: '+34600111222',
          checklistDone: 2,
          checklistTotal: 4,
          commentCount: 3,
          labels: ['revision'],
          assigneeIds: [LUCIA.userId, MARTA.userId],
          dueAt: '2026-09-02T12:30:00.000Z',
          dueAllDay: false,
          requiresEvidence: true,
          source: 'AUTOMATION',
        }),
      ],
    });
    const card = screen.getByRole('article');
    const t = card.textContent ?? '';
    expect(t).toContain('#paciente'); // CategoryChip
    expect(t).toContain('Urgente'); // PriorityChip
    expect(t).toContain('#revision'); // etiqueta
    expect(t).toContain('María Gómez');
    expect(t).toContain('+34600111222');
    expect(t).toContain('50%'); // progreso del checklist 2/4
    // El contador "2/4" se quitó a propósito: repetía lo que ya dice la barra.
    expect(t).not.toContain('2/4');
    expect(t).toContain('3'); // comentarios
    expect(within(card).getByLabelText('2 de 4 pasos hechos')).toBeTruthy();
    expect(within(card).getByLabelText('Requiere evidencia para cerrarse')).toBeTruthy();
    // avatares de los dos responsables
    expect(within(card).getByTitle('Lucía')).toBeTruthy();
    expect(within(card).getByTitle('Marta')).toBeTruthy();
    // vencimiento: hoy con hora
    expect(t).toMatch(/hoy\s+\d{2}:\d{2}/);
  });

  it('sin responsables muestra "Sin responsable"', () => {
    renderBoard({ tasks: [task({ id: 'y', assigneeIds: [] })] });
    expect(screen.getByText('Sin responsable')).toBeTruthy();
  });

  it('marca las vencidas', () => {
    renderBoard({
      tasks: [task({ id: 'z', dueAt: '2026-09-01T09:00:00.000Z', dueAllDay: false })],
    });
    expect(screen.getByRole('article').textContent).toContain('vencida');
  });

  it('abrir una card llama a onOpen con su id', () => {
    const { onOpen } = renderBoard({ tasks: [task({ id: 'abre-me', title: 'Ábreme' })] });
    screen.getByRole('article').click();
    expect(onOpen).toHaveBeenCalledWith('abre-me');
  });

  it('el botón + de la columna pide alta rápida en ese estado', () => {
    const { onQuickAdd } = renderBoard();
    screen.getByLabelText('Nueva tarea en En curso').click();
    expect(onQuickAdd).toHaveBeenCalledWith('IN_PROGRESS');
  });

  it('sin permiso de edición no hay botón de alta ni cards arrastrables', () => {
    renderBoard({ canEdit: false });
    expect(screen.queryByLabelText('Nueva tarea en En curso')).toBeNull();
    for (const card of screen.getAllByRole('article')) {
      expect(card.getAttribute('draggable')).toBe('false');
    }
  });
});
