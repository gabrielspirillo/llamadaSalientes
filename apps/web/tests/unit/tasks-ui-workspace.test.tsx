// Bloques 3 y 4 — Actualización optimista, vuelta atrás y gate de evidencia.

import { TasksWorkspace } from '@/components/tasks/TasksWorkspace';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LUCIA,
  MEMBERS,
  detail,
  fakeDataTransfer,
  mockFetch,
  stats,
  task,
} from './tasks-ui-fixtures';

vi.mock('next/link', () => ({
  default: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}));

afterEach(cleanup);

let fetchMock: ReturnType<typeof mockFetch>;

beforeEach(() => {
  fetchMock = mockFetch();
});

function renderWorkspace(over: Partial<Parameters<typeof TasksWorkspace>[0]> = {}) {
  const tasks = over.initialTasks ?? [
    task({ id: 'a', title: 'Abrir gabinete', status: 'TODO' }),
    task({ id: 'b', title: 'Cuadrar caja', status: 'TODO' }),
  ];
  return render(
    <TasksWorkspace
      initialTasks={tasks}
      initialStats={stats()}
      members={MEMBERS}
      templates={[]}
      rules={[]}
      currentUserId={LUCIA.userId}
      role="operator"
      {...over}
    />,
  );
}

function columnOf(label: string): HTMLElement {
  return screen.getByRole('heading', { name: label, level: 2 }).closest('section') as HTMLElement;
}

function cardOf(title: string): HTMLElement {
  return screen.getByText(title).closest('article') as HTMLElement;
}

describe('TasksWorkspace — reorder optimista con rollback', () => {
  it('mueve la card al soltar y la devuelve si el servidor responde 422', async () => {
    // fetch que se queda colgado hasta que lo resolvemos a mano: así podemos
    // observar el estado optimista antes de la respuesta.
    let reject!: (r: Response) => void;
    const pending = new Promise<Response>((res) => {
      reject = res;
    });
    fetchMock.spy.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      fetchMock.calls.push({
        url,
        method: (init?.method ?? 'GET').toUpperCase(),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      if (url.includes('/api/tasks/reorder')) return pending;
      return {
        ok: true,
        status: 200,
        json: async () => ({ tasks: [], stats: stats() }),
      } as unknown as Response;
    });

    renderWorkspace();

    const dt = fakeDataTransfer();
    fireEvent.dragStart(cardOf('Abrir gabinete'), { dataTransfer: dt });
    fireEvent.dragOver(columnOf('En curso'), { dataTransfer: dt });
    fireEvent.drop(columnOf('En curso'), { dataTransfer: dt });

    // Optimista: ya está en "En curso" sin esperar al servidor.
    await waitFor(() =>
      expect(within(columnOf('En curso')).getByText('Abrir gabinete')).toBeTruthy(),
    );
    expect(within(columnOf('Por hacer')).queryByText('Abrir gabinete')).toBeNull();

    const call = fetchMock.callsTo('/api/tasks/reorder')[0];
    expect(call?.method).toBe('POST');
    expect(call?.body).toEqual({ status: 'IN_PROGRESS', orderedIds: ['a'] });

    // El servidor rechaza (evidencia pendiente).
    reject({
      ok: false,
      status: 422,
      json: async () => ({ error: 'Estas tareas exigen evidencia para cerrarse: Abrir gabinete' }),
    } as unknown as Response);

    // Rollback + aviso.
    await waitFor(() =>
      expect(within(columnOf('Por hacer')).getByText('Abrir gabinete')).toBeTruthy(),
    );
    expect(within(columnOf('En curso')).queryByText('Abrir gabinete')).toBeNull();
    expect(
      screen.getByText('Estas tareas exigen evidencia para cerrarse: Abrir gabinete'),
    ).toBeTruthy();
  });

  it('si el servidor acepta, la card se queda y se refresca el tablero', async () => {
    fetchMock.on('/api/tasks/reorder', { status: 200, json: { ok: true } });
    fetchMock.on('/api/tasks', { status: 200, json: { tasks: [], stats: stats() } }, {
      method: 'GET',
    });
    renderWorkspace();

    const dt = fakeDataTransfer();
    fireEvent.dragStart(cardOf('Abrir gabinete'), { dataTransfer: dt });
    fireEvent.dragOver(columnOf('En revisión'), { dataTransfer: dt });
    fireEvent.drop(columnOf('En revisión'), { dataTransfer: dt });

    await waitFor(() => expect(fetchMock.callsTo('/api/tasks/reorder').length).toBe(1));
    // tras el POST se pide el tablero de nuevo
    await waitFor(() =>
      expect(fetchMock.calls.some((c) => c.url === '/api/tasks' && c.method === 'GET')).toBe(true),
    );
  });
});

describe('TasksWorkspace — check rápido optimista', () => {
  function openMyDay() {
    fireEvent.click(screen.getByRole('button', { name: /Mi día/ }));
  }

  it('marca la tarea como hecha al instante y la revierte si el PATCH falla', async () => {
    fetchMock.on(/\/api\/tasks\/a$/, { status: 500, json: { error: 'No se pudo actualizar' } });
    renderWorkspace({
      initialTasks: [task({ id: 'a', title: 'Llamar a María', status: 'TODO' })],
    });
    openMyDay();

    const row = screen.getByText('Llamar a María').closest('li') as HTMLElement;
    fireEvent.click(within(row).getByLabelText('Marcar como hecha'));

    // Optimista: la fila pasa a "Reabrir tarea".
    await waitFor(() => expect(screen.getByLabelText('Reabrir tarea')).toBeTruthy());

    const call = fetchMock.callsTo('/api/tasks/a')[0];
    expect(call?.method).toBe('PATCH');
    expect(call?.body).toEqual({ status: 'DONE' });

    // Rollback + aviso.
    await waitFor(() => expect(screen.getByText('No se pudo actualizar')).toBeTruthy());
    expect(screen.getByLabelText('Marcar como hecha')).toBeTruthy();
  });

  it('reabre una tarea cerrada mandando status TODO', async () => {
    fetchMock.on(/\/api\/tasks\/a$/, { status: 200, json: { ok: true } });
    renderWorkspace({
      initialTasks: [
        task({
          id: 'a',
          title: 'Ya cerrada',
          status: 'DONE',
          completedAt: new Date().toISOString(),
        }),
      ],
    });
    openMyDay();

    fireEvent.click(screen.getByLabelText('Reabrir tarea'));
    await waitFor(() => expect(fetchMock.callsTo('/api/tasks/a').length).toBe(1));
    expect(fetchMock.callsTo('/api/tasks/a')[0]?.body).toEqual({ status: 'TODO' });
  });
});

describe('TasksWorkspace — gate de evidencia en el cliente', () => {
  it('no llama a la API, avisa y abre el detalle', async () => {
    fetchMock.on(/\/api\/tasks\/ev$/, {
      status: 200,
      json: { task: detail({ id: 'ev', title: 'Ciclo de esterilización', requiresEvidence: true }) },
    });
    renderWorkspace({
      initialTasks: [
        task({
          id: 'ev',
          title: 'Ciclo de esterilización',
          requiresEvidence: true,
          evidenceNote: null,
        }),
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: /Mi día/ }));
    fireEvent.click(screen.getByLabelText('Marcar como hecha'));

    expect(
      screen.getByText('Esta tarea exige una nota de evidencia antes de cerrarse.'),
    ).toBeTruthy();
    // Ningún PATCH: solo el GET del panel de detalle que se acaba de abrir.
    expect(fetchMock.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    await waitFor(() =>
      expect(fetchMock.calls.some((c) => c.url === '/api/tasks/ev' && c.method === 'GET')).toBe(
        true,
      ),
    );
    await waitFor(() => expect(screen.getByText('Evidencia para cerrar')).toBeTruthy());
  });

  it('con nota de evidencia ya escrita sí deja cerrarla', async () => {
    fetchMock.on(/\/api\/tasks\/ev$/, { status: 200, json: { ok: true } });
    renderWorkspace({
      initialTasks: [
        task({
          id: 'ev',
          title: 'Ciclo de esterilización',
          requiresEvidence: true,
          evidenceNote: 'Ciclo 42 OK',
        }),
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: /Mi día/ }));
    fireEvent.click(screen.getByLabelText('Marcar como hecha'));

    await waitFor(() => expect(fetchMock.callsTo('/api/tasks/ev').length).toBe(1));
    expect(fetchMock.callsTo('/api/tasks/ev')[0]?.method).toBe('PATCH');
  });
});
