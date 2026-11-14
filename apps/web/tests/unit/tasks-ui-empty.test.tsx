// Bloque 9 — Estados vacíos (y la franja de indicadores cuando no hay nada).

import { RoutinesView } from '@/components/tasks/RoutinesView';
import { TaskDetailPanel } from '@/components/tasks/TaskDetailPanel';
import { TasksHero } from '@/components/tasks/TasksHero';
import { TasksWorkspace } from '@/components/tasks/TasksWorkspace';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LUCIA, MEMBERS, detail, mockFetch, stats, template } from './tasks-ui-fixtures';

vi.mock('next/link', () => ({
  default: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}));

afterEach(cleanup);

// Literal fuera del JSX: biome confunde la prop `role` con el atributo ARIA.
const OPERATOR = 'operator' as const;

let fetchMock: ReturnType<typeof mockFetch>;
beforeEach(() => {
  fetchMock = mockFetch();
});

describe('Tablero sin tareas', () => {
  it('cada columna dice algo útil en vez de quedarse en blanco', () => {
    render(
      <TasksWorkspace
        initialTasks={[]}
        initialStats={stats()}
        members={MEMBERS}
        templates={[]}
        rules={[]}
        currentUserId={LUCIA.userId}
        role={OPERATOR}
        initialView="board"
      />,
    );
    expect(screen.getByText('Sin pendientes aquí')).toBeTruthy();
    expect(screen.getByText('Alguien ya lo está haciendo')).toBeTruthy();
    expect(screen.getByText('Esperando verificación')).toBeTruthy();
    expect(screen.getByText('Cerrado con evidencia')).toBeTruthy();
  });

  it('"Hoy" y "Pacientes" tienen su propio vacío', () => {
    render(
      <TasksWorkspace
        initialTasks={[]}
        initialStats={stats()}
        members={MEMBERS}
        templates={[]}
        rules={[]}
        currentUserId={LUCIA.userId}
        role={OPERATOR}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Hoy/ }));
    expect(screen.getByText('Todo al día')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Pacientes/ }));
    expect(screen.getByText('Ningún paciente esperando')).toBeTruthy();
  });
});

describe('Cabecera de Tareas sin datos', () => {
  it('no inventa métricas: sin nada para hoy lo dice y el % queda en guion', () => {
    render(<TasksHero tasks={[]} stats={stats()} now={new Date(2026, 8, 2, 12)} />);
    expect(screen.getByText('Hoy no hay nada programado')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('cuenta lo que queda para hoy', () => {
    render(<TasksHero tasks={[]} stats={stats({ today: 3 })} now={new Date(2026, 8, 2, 12)} />);
    expect(screen.getByText('Te quedan 3 tareas para hoy')).toBeTruthy();
  });
});

describe('Rutinas sin nada cargado', () => {
  it('sin plantillas no ofrece catálogo de serie: invita a crear la primera', async () => {
    fetchMock.on('/api/tasks/postop-treatments', { status: 200, json: { treatments: [] } });
    render(
      <RoutinesView templates={[]} rules={[]} members={MEMBERS} isAdmin onRefresh={vi.fn()} />,
    );
    expect(screen.getByText('Todavía no hay rutinas')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Instalar catálogo/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Crear la primera rutina/ }));
    expect(await screen.findByText('Nueva rutina', { selector: 'h2' })).toBeTruthy();
  });

  it('sin plantillas y sin ser admin no se ofrece instalar nada', async () => {
    fetchMock.on('/api/tasks/postop-treatments', { status: 200, json: { treatments: [] } });
    render(
      <RoutinesView
        templates={[]}
        rules={[]}
        members={MEMBERS}
        isAdmin={false}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText('Todavía no hay rutinas')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Instalar catálogo/ })).toBeNull();
  });

  it('sin reglas y sin tratamientos avisa de ambas cosas', async () => {
    fetchMock.on('/api/tasks/postop-treatments', { status: 200, json: { treatments: [] } });
    render(
      <RoutinesView
        templates={[template()]}
        rules={[]}
        members={MEMBERS}
        isAdmin
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText('Sin automatizaciones')).toBeTruthy();
    expect(await screen.findByText('Sin tratamientos cargados')).toBeTruthy();
  });

  it('una rutina sin pasos lo dice al desplegarla', () => {
    fetchMock.on('/api/tasks/postop-treatments', { status: 200, json: { treatments: [] } });
    render(
      <RoutinesView
        templates={[template({ items: [] })]}
        rules={[]}
        members={MEMBERS}
        isAdmin
        onRefresh={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Ver los pasos/ }));
    expect(screen.getByText('Sin pasos definidos.')).toBeTruthy();
    expect(screen.getByText('0 pasos')).toBeTruthy();
  });
});

describe('Detalle sin equipo ni actividad', () => {
  it('sin miembros explica cómo invitar; sin comentarios lo dice', async () => {
    fetchMock.on(/\/api\/tasks\/d1$/, {
      status: 200,
      json: { task: detail({ id: 'd1', title: 'Sola en el mundo' }) },
    });
    render(
      <TaskDetailPanel taskId="d1" members={[]} canEdit onClose={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(
      await screen.findByText(
        'Invita al equipo desde Clínica → Equipo para poder repartir tareas.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Todavía no ha pasado nada aquí.')).toBeTruthy();
  });
});
