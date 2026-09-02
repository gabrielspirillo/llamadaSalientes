// Bloque 8 — Filtros y búsqueda.

import { TasksWorkspace } from '@/components/tasks/TasksWorkspace';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LUCIA, MARTA, MEMBERS, mockFetch, stats, task } from './tasks-ui-fixtures';

afterEach(cleanup);

// Literal fuera del JSX: biome confunde la prop `role` con el atributo ARIA.
const OPERATOR = 'operator' as const;

beforeEach(() => {
  mockFetch();
});

const TASKS = [
  task({
    id: 't1',
    title: 'Devolver llamada',
    category: 'PATIENT',
    priority: 'URGENT',
    source: 'AUTOMATION',
    assigneeIds: [LUCIA.userId],
    patientName: 'María Gómez',
  }),
  task({
    id: 't2',
    title: 'Cuadrar la caja',
    category: 'ADMIN',
    priority: 'MEDIUM',
    source: 'ROUTINE',
    assigneeIds: [MARTA.userId],
    labels: ['cierre'],
  }),
  task({
    id: 't3',
    title: 'Revisar consentimientos',
    category: 'COMPLIANCE',
    priority: 'URGENT',
    source: 'MANUAL',
    assigneeIds: [],
    description: 'Carpeta de RGPD',
  }),
];

function renderWorkspace(tasks = TASKS) {
  render(
    <TasksWorkspace
      initialTasks={tasks}
      initialStats={stats()}
      members={MEMBERS}
      templates={[]}
      rules={[]}
      currentUserId={LUCIA.userId}
      role={OPERATOR}
    />,
  );
}

function visibleTitles(): string[] {
  return screen.getAllByRole('article').map((a) => a.querySelector('h3')?.textContent ?? '');
}

function openFilters() {
  fireEvent.click(screen.getByRole('button', { name: /Filtros/ }));
}

function filterCount(): string {
  const btn = screen.getByRole('button', { name: /Filtros/ });
  return btn.textContent?.replace('Filtros', '').trim() ?? '';
}

describe('TasksWorkspace — búsqueda', () => {
  it('filtra por título', () => {
    renderWorkspace();
    fireEvent.change(screen.getByPlaceholderText('Buscar tarea o paciente'), {
      target: { value: 'caja' },
    });
    expect(visibleTitles()).toEqual(['Cuadrar la caja']);
  });

  it('busca también en paciente, descripción y etiquetas', () => {
    renderWorkspace();
    const input = screen.getByPlaceholderText('Buscar tarea o paciente');

    fireEvent.change(input, { target: { value: 'maría' } });
    expect(visibleTitles()).toEqual(['Devolver llamada']);

    fireEvent.change(input, { target: { value: 'rgpd' } });
    expect(visibleTitles()).toEqual(['Revisar consentimientos']);

    fireEvent.change(input, { target: { value: 'cierre' } });
    expect(visibleTitles()).toEqual(['Cuadrar la caja']);
  });

  it('sin resultados deja el tablero vacío', () => {
    renderWorkspace();
    fireEvent.change(screen.getByPlaceholderText('Buscar tarea o paciente'), {
      target: { value: 'zzzz' },
    });
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByText('Sin pendientes aquí')).toBeTruthy();
  });
});

describe('TasksWorkspace — filtros por chip', () => {
  it('categoría', () => {
    renderWorkspace();
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Cumplimiento' }));
    expect(visibleTitles()).toEqual(['Revisar consentimientos']);
    expect(filterCount()).toBe('1');
  });

  it('prioridad', () => {
    renderWorkspace();
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Urgente' }));
    expect(visibleTitles().sort()).toEqual(['Devolver llamada', 'Revisar consentimientos']);
  });

  it('origen', () => {
    renderWorkspace();
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Rutina' }));
    expect(visibleTitles()).toEqual(['Cuadrar la caja']);
  });

  it('asignado, haciendo clic en su avatar', () => {
    renderWorkspace();
    fireEvent.click(screen.getByTitle('Filtrar por Marta'));
    expect(visibleTitles()).toEqual(['Cuadrar la caja']);
    expect(filterCount()).toBe('1');
    // segundo clic lo quita
    fireEvent.click(screen.getByTitle('Filtrar por Marta'));
    expect(visibleTitles()).toHaveLength(3);
  });

  it('se combinan entre sí y con el texto', () => {
    renderWorkspace();
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Urgente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Paciente' }));
    expect(visibleTitles()).toEqual(['Devolver llamada']);
    expect(filterCount()).toBe('2');

    fireEvent.change(screen.getByPlaceholderText('Buscar tarea o paciente'), {
      target: { value: 'consentimientos' },
    });
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('el contador cuenta los cuatro filtros', () => {
    renderWorkspace();
    fireEvent.click(screen.getByTitle('Filtrar por Lucía'));
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Paciente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Urgente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Automática' }));
    expect(filterCount()).toBe('4');
    expect(visibleTitles()).toEqual(['Devolver llamada']);
  });

  it('volver a pulsar el mismo chip lo desactiva', () => {
    renderWorkspace();
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Cumplimiento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cumplimiento' }));
    expect(visibleTitles()).toHaveLength(3);
    expect(filterCount()).toBe('');
  });

  it('"Limpiar" resetea los chips y el avatar', () => {
    renderWorkspace();
    fireEvent.click(screen.getByTitle('Filtrar por Lucía'));
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Paciente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Urgente' }));
    expect(filterCount()).toBe('3');

    fireEvent.click(screen.getByRole('button', { name: /Limpiar/ }));
    expect(filterCount()).toBe('');
    expect(visibleTitles()).toHaveLength(3);
  });

  it('"Limpiar" borra también el texto de búsqueda', () => {
    // Antes el buscador sobrevivía al "Limpiar": el contador marcaba 0 filtros
    // y el tablero seguía recortado, sin nada en pantalla que lo explicara.
    renderWorkspace();
    fireEvent.change(screen.getByPlaceholderText('Buscar tarea o paciente'), {
      target: { value: 'caja' },
    });
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Administración' }));
    fireEvent.click(screen.getByRole('button', { name: /Limpiar/ }));

    expect(filterCount()).toBe('');
    expect(visibleTitles().length).toBeGreaterThan(1);
    expect((screen.getByPlaceholderText('Buscar tarea o paciente') as HTMLInputElement).value).toBe(
      '',
    );
  });
});

describe('TasksWorkspace — los filtros valen para todas las vistas', () => {
  it('lo filtrado en el tablero también lo está en "Mi día"', () => {
    renderWorkspace();
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Rutina' }));
    fireEvent.click(screen.getByRole('button', { name: /Mi día/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Toda la clínica' }));

    const list = screen.getAllByRole('listitem');
    expect(list).toHaveLength(1);
    expect(within(list[0] as HTMLElement).getByText('Cuadrar la caja')).toBeTruthy();
  });
});
