// Bloque 9 — Estados vacíos (y la franja de indicadores cuando no hay nada).

import { RoutinesView } from '@/components/tasks/RoutinesView';
import { StatsBar } from '@/components/tasks/StatsBar';
import { TaskDetailPanel } from '@/components/tasks/TaskDetailPanel';
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
      />,
    );
    expect(screen.getByText('Sin pendientes aquí')).toBeTruthy();
    expect(screen.getByText('Alguien ya lo está haciendo')).toBeTruthy();
    expect(screen.getByText('Esperando verificación')).toBeTruthy();
    expect(screen.getByText('Cerrado con evidencia')).toBeTruthy();
  });

  it('"Mi día" y "Pacientes" tienen su propio vacío', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /Mi día/ }));
    expect(screen.getByText('Día limpio')).toBeTruthy();
    expect(screen.getByText(/activa las rutinas para que el tablero se llene solo/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Pacientes/ }));
    expect(screen.getByText('Ningún paciente esperando')).toBeTruthy();
  });
});

describe('StatsBar sin datos', () => {
  it('no inventa métricas ni pinta la carga por persona', () => {
    render(<StatsBar stats={stats()} members={MEMBERS} />);
    expect(screen.getByText('Nada sin cerrar de otros días')).toBeTruthy();
    expect(screen.getByText('Aún no hay histórico')).toBeTruthy();
    // 0 tareas de cualquier origen → 0% automatizado, sin división por cero
    expect(screen.getAllByText('0%').length).toBeGreaterThan(0);
    expect(screen.queryByText('Carga por persona')).toBeNull();
  });

  it('con carga por persona sí la muestra', () => {
    render(
      <StatsBar
        stats={stats({
          perMember: [{ userId: LUCIA.userId, open: 3, overdue: 1, doneThisWeek: 2 }],
        })}
        members={MEMBERS}
      />,
    );
    expect(screen.getByText('Carga por persona')).toBeTruthy();
    expect(screen.getByText('3 abiertas')).toBeTruthy();
    expect(screen.getByText('1 vencidas')).toBeTruthy();
  });
});

describe('Rutinas sin nada cargado', () => {
  it('sin plantillas ofrece instalar el catálogo y lo pide al servidor', async () => {
    fetchMock.on('/api/tasks/postop-treatments', { status: 200, json: { treatments: [] } });
    render(
      <RoutinesView templates={[]} rules={[]} members={MEMBERS} isAdmin onRefresh={vi.fn()} />,
    );
    expect(screen.getByText('Todavía no hay rutinas')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Instalar catálogo/ }));
    await waitFor(() => expect(fetchMock.callsTo('/api/tasks/templates').length).toBe(1));
    const call = fetchMock.callsTo('/api/tasks/templates')[0];
    expect(call?.method).toBe('POST');
    expect(call?.body).toEqual({ action: 'seed' });
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
    expect(screen.getByText('Sin reglas cargadas')).toBeTruthy();
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
