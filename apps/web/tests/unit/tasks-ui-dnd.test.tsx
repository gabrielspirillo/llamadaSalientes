// Bloque 2 — Drag & drop nativo del tablero.
//
// happy-dom no implementa DataTransfer ni el gesto de arrastre del navegador:
// lo que se prueba aquí es la máquina de estados de KanbanBoard alimentada con
// los mismos eventos que React recibiría (dragStart → dragOver → drop), con un
// DataTransfer de mentira. El gesto físico (imagen de arrastre, autoscroll)
// queda fuera de alcance.

import { KanbanBoard } from '@/components/tasks/KanbanBoard';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MEMBERS, fakeDataTransfer, fireDragOver, task } from './tasks-ui-fixtures';

afterEach(cleanup);

const NOW = new Date('2026-09-02T10:00:00.000Z');

const BASE = [
  task({ id: 'a', title: 'A', status: 'TODO' }),
  task({ id: 'b', title: 'B', status: 'TODO' }),
  task({ id: 'c', title: 'C', status: 'TODO' }),
  task({ id: 'p1', title: 'P1', status: 'IN_PROGRESS' }),
  task({ id: 'p2', title: 'P2', status: 'IN_PROGRESS' }),
];

function setup(canEdit = true, tasks = BASE) {
  const onReorder = vi.fn();
  render(
    <KanbanBoard
      tasks={tasks}
      members={MEMBERS}
      now={NOW}
      canEdit={canEdit}
      onOpen={vi.fn()}
      onReorder={onReorder}
      onQuickAdd={vi.fn()}
      onComplete={vi.fn()}
    />,
  );
  return { onReorder };
}

function columnOf(label: string): HTMLElement {
  const h = screen.getByRole('heading', { name: label, level: 2 });
  return h.closest('section') as HTMLElement;
}

function cardOf(title: string): HTMLElement {
  return screen.getByText(title).closest('article') as HTMLElement;
}

/** El <div> que envuelve la card es quien escucha el dragOver posicional. */
function slotOf(title: string): HTMLElement {
  return cardOf(title).parentElement as HTMLElement;
}

describe('KanbanBoard — drag & drop', () => {
  it('mover dentro de la misma columna manda el orden completo resultante', () => {
    const { onReorder } = setup();
    const dt = fakeDataTransfer();

    fireEvent.dragStart(cardOf('A'), { dataTransfer: dt });
    // Soltamos por debajo de C: el rect va de 100 a 140, así que 135 cae en
    // la mitad inferior → se inserta DESPUÉS de C.
    fireDragOver(slotOf('C'), { clientY: 135, rect: { top: 100, height: 40 } });
    fireEvent.drop(columnOf('Por hacer'), { dataTransfer: dt });

    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith('TODO', ['b', 'c', 'a']);
  });

  it('mover al principio de la misma columna', () => {
    const { onReorder } = setup();
    const dt = fakeDataTransfer();

    fireEvent.dragStart(cardOf('C'), { dataTransfer: dt });
    // 105 cae en la mitad superior del rect de A → se inserta ANTES de A.
    fireDragOver(slotOf('A'), { clientY: 105, rect: { top: 100, height: 40 } });
    fireEvent.drop(columnOf('Por hacer'), { dataTransfer: dt });

    expect(onReorder).toHaveBeenCalledWith('TODO', ['c', 'a', 'b']);
  });

  it('mover a otra columna, al final', () => {
    const { onReorder } = setup();
    const dt = fakeDataTransfer();

    fireEvent.dragStart(cardOf('A'), { dataTransfer: dt });
    fireEvent.dragOver(columnOf('En curso'), { dataTransfer: dt });
    fireEvent.drop(columnOf('En curso'), { dataTransfer: dt });

    expect(onReorder).toHaveBeenCalledWith('IN_PROGRESS', ['p1', 'p2', 'a']);
  });

  it('mover a otra columna, insertando en medio', () => {
    const { onReorder } = setup();
    const dt = fakeDataTransfer();

    fireEvent.dragStart(cardOf('A'), { dataTransfer: dt });
    // mitad inferior de P1 → índice 1
    fireDragOver(slotOf('P1'), { clientY: 135, rect: { top: 100, height: 40 } });
    fireEvent.drop(columnOf('En curso'), { dataTransfer: dt });

    expect(onReorder).toHaveBeenCalledWith('IN_PROGRESS', ['p1', 'a', 'p2']);
  });

  it('soltar en una columna vacía la deja con la tarea sola', () => {
    const { onReorder } = setup();
    const dt = fakeDataTransfer();

    fireEvent.dragStart(cardOf('A'), { dataTransfer: dt });
    fireEvent.dragOver(columnOf('En revisión'), { dataTransfer: dt });
    fireEvent.drop(columnOf('En revisión'), { dataTransfer: dt });

    expect(onReorder).toHaveBeenCalledWith('IN_REVIEW', ['a']);
  });

  it('soltar sin haber arrastrado nada no llama a onReorder', () => {
    const { onReorder } = setup();
    fireEvent.drop(columnOf('Por hacer'), { dataTransfer: fakeDataTransfer() });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('un viewer no puede reordenar aunque se disparen los eventos', () => {
    const { onReorder } = setup(false);
    const dt = fakeDataTransfer();
    fireEvent.dragStart(cardOf('A'), { dataTransfer: dt });
    fireEvent.dragOver(columnOf('En curso'), { dataTransfer: dt });
    fireEvent.drop(columnOf('En curso'), { dataTransfer: dt });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('dragEnd limpia el estado: un drop posterior no mueve nada', () => {
    const { onReorder } = setup();
    const dt = fakeDataTransfer();
    fireEvent.dragStart(cardOf('A'), { dataTransfer: dt });
    fireEvent.dragEnd(cardOf('A'), { dataTransfer: dt });
    fireEvent.drop(columnOf('En curso'), { dataTransfer: dt });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('durante el arrastre la card origen se marca y aparece el placeholder', () => {
    setup();
    const dt = fakeDataTransfer();
    fireEvent.dragStart(cardOf('A'), { dataTransfer: dt });
    expect(cardOf('A').className).toContain('opacity-40');
    fireEvent.dragOver(columnOf('En curso'), { dataTransfer: dt });
    const placeholders = columnOf('En curso').querySelectorAll('[aria-hidden="true"]');
    expect(placeholders.length).toBeGreaterThan(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // HALLAZGO: al mover una card HACIA ABAJO dentro de su propia columna, el
  // índice que calcula el dragOver está referido a la columna CON la card
  // todavía dentro, pero handleDrop la quita antes de insertar. Resultado: la
  // tarea cae una posición más abajo de donde el usuario vio el placeholder.
  // KanbanBoard.tsx:42-52 (handleDrop) vs. KanbanBoard.tsx:100-116 (cálculo del índice).
  // Estos dos tests describen lo que el usuario espera; hoy FALLAN.
  // ───────────────────────────────────────────────────────────────────────────

  it('soltar entre B y C (bajando dentro de la columna) deja A entre B y C', () => {
    const { onReorder } = setup();
    const dt = fakeDataTransfer();

    fireEvent.dragStart(cardOf('A'), { dataTransfer: dt });
    // Mitad inferior de B → el placeholder se dibuja entre B y C.
    fireDragOver(slotOf('B'), { clientY: 135, rect: { top: 100, height: 40 } });
    // El placeholder está delante de C: eso es lo que ve el usuario.
    expect(slotOf('C').querySelector('[aria-hidden="true"]')).toBeTruthy();
    fireEvent.drop(columnOf('Por hacer'), { dataTransfer: dt });

    expect(onReorder).toHaveBeenCalledWith('TODO', ['b', 'a', 'c']);
  });

  it('soltar en el mismo sitio del que salió no llama al servidor', () => {
    const { onReorder } = setup();
    const dt = fakeDataTransfer();

    fireEvent.dragStart(cardOf('A'), { dataTransfer: dt });
    // Mitad superior de B → placeholder entre A y B: la card vuelve a su sitio.
    fireDragOver(slotOf('B'), { clientY: 105, rect: { top: 100, height: 40 } });
    fireEvent.drop(columnOf('Por hacer'), { dataTransfer: dt });

    // Un drag que deja todo igual no es un movimiento: ni PATCH ni parpadeo.
    expect(onReorder).not.toHaveBeenCalled();
  });
});
