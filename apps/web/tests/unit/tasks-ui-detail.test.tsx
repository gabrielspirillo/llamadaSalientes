// Bloque 6 — Panel de detalle.

import { TaskDetailPanel } from '@/components/tasks/TaskDetailPanel';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LUCIA, MARTA, MEMBERS, detail, mockFetch } from './tasks-ui-fixtures';

vi.mock('next/link', () => ({
  default: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}));

afterEach(cleanup);

let fetchMock: ReturnType<typeof mockFetch>;
beforeEach(() => {
  fetchMock = mockFetch();
});

const TASK = detail({
  id: 'd1',
  title: 'Revisar el autoclave',
  description: 'Ciclo B, control biológico semanal',
  category: 'CLINICAL',
  priority: 'HIGH',
  status: 'IN_PROGRESS',
  dueAt: '2026-09-05T09:00:00.000Z',
  dueAllDay: false,
  assigneeIds: [LUCIA.userId],
  checklistTotal: 2,
  checklistDone: 1,
  checklist: [
    { id: 'c1', content: 'Cargar el ciclo', done: true, order: 1 },
    { id: 'c2', content: 'Registrar el resultado', done: false, order: 2 },
  ],
  comments: [
    {
      id: 'cm1',
      kind: 'comment',
      body: 'Lo hago yo a las 14h',
      authorUserId: LUCIA.userId,
      authorName: 'Lucía',
      createdAt: '2026-09-02T09:00:00.000Z',
    },
  ],
});

async function setup(opts: { canEdit?: boolean; task?: typeof TASK } = {}) {
  fetchMock.on(/\/api\/tasks\/d1$/, { status: 200, json: { task: opts.task ?? TASK } });
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const utils = render(
    <TaskDetailPanel
      taskId="d1"
      members={MEMBERS}
      canEdit={opts.canEdit ?? true}
      onClose={onClose}
      onChanged={onChanged}
    />,
  );
  await screen.findByDisplayValue('Revisar el autoclave');
  return { ...utils, onClose, onChanged };
}

function lastPatch() {
  const patches = fetchMock.calls.filter((c) => c.method === 'PATCH');
  return patches[patches.length - 1];
}

describe('TaskDetailPanel — carga', () => {
  it('pide la tarea y pinta título, campos, checklist y actividad', async () => {
    await setup();
    expect(fetchMock.callsTo('/api/tasks/d1')[0]?.method).toBe('GET');
    expect(screen.getByDisplayValue('Revisar el autoclave')).toBeTruthy();
    expect(screen.getByDisplayValue('Ciclo B, control biológico semanal')).toBeTruthy();
    expect((screen.getByDisplayValue('En curso') as HTMLSelectElement).value).toBe('IN_PROGRESS');
    expect((screen.getByDisplayValue('Alta') as HTMLSelectElement).value).toBe('HIGH');
    expect((screen.getByDisplayValue('Gabinete') as HTMLSelectElement).value).toBe('CLINICAL');
    expect(screen.getByText('Cargar el ciclo')).toBeTruthy();
    expect(screen.getByText('Registrar el resultado')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy();
    expect(screen.getByText('Lo hago yo a las 14h')).toBeTruthy();
  });

  it('muestra el error si la carga falla', async () => {
    fetchMock.on(/\/api\/tasks\/d1$/, { status: 404, json: { error: 'No existe' } });
    render(
      <TaskDetailPanel
        taskId="d1"
        members={MEMBERS}
        canEdit
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    expect(await screen.findByText('No existe')).toBeTruthy();
  });
});

describe('TaskDetailPanel — edición', () => {
  it('cambiar el estado dispara PATCH { status }', async () => {
    const { onChanged } = await setup();
    fireEvent.change(screen.getByDisplayValue('En curso'), { target: { value: 'DONE' } });
    await waitFor(() => expect(lastPatch()).toBeTruthy());
    expect(lastPatch()?.url).toBe('/api/tasks/d1');
    expect(lastPatch()?.body).toEqual({ status: 'DONE' });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('cambiar la prioridad dispara PATCH { priority }', async () => {
    await setup();
    fireEvent.change(screen.getByDisplayValue('Alta'), { target: { value: 'URGENT' } });
    await waitFor(() => expect(lastPatch()?.body).toEqual({ priority: 'URGENT' }));
  });

  it('cambiar la categoría dispara PATCH { category }', async () => {
    await setup();
    fireEvent.change(screen.getByDisplayValue('Gabinete'), { target: { value: 'COMPLIANCE' } });
    await waitFor(() => expect(lastPatch()?.body).toEqual({ category: 'COMPLIANCE' }));
  });

  it('cambiar la fecha manda ISO y dueAllDay false', async () => {
    const { container } = await setup();
    const input = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-09-10T09:15' } });
    await waitFor(() => expect(lastPatch()).toBeTruthy());
    const body = lastPatch()?.body as { dueAt: string; dueAllDay: boolean };
    expect(body.dueAllDay).toBe(false);
    const d = new Date(body.dueAt);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(15);
  });

  it('editar el título en el blur dispara PATCH { title }', async () => {
    const { container } = await setup();
    const title = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.blur(title, { target: { value: 'Validar el autoclave' } });
    await waitFor(() => expect(lastPatch()?.body).toEqual({ title: 'Validar el autoclave' }));
  });

  it('un título vacío o igual no dispara nada', async () => {
    const { container } = await setup();
    const title = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.blur(title, { target: { value: '   ' } });
    fireEvent.blur(title, { target: { value: 'Revisar el autoclave' } });
    expect(fetchMock.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });

  it('el toggle de responsables suma y resta', async () => {
    await setup();
    // Marta no estaba: se añade a los que ya hay.
    fireEvent.click(screen.getByRole('button', { name: /Marta/ }));
    await waitFor(() =>
      expect(lastPatch()?.body).toEqual({ assigneeUserIds: [LUCIA.userId, MARTA.userId] }),
    );
    // Lucía sí estaba: se quita.
    fireEvent.click(screen.getByRole('button', { name: /Lucía/ }));
    await waitFor(() => expect(lastPatch()?.body).toEqual({ assigneeUserIds: [] }));
  });
});

describe('TaskDetailPanel — checklist, comentarios y archivado', () => {
  it('añadir paso hace POST con el contenido', async () => {
    await setup();
    const input = screen.getByPlaceholderText('Añadir paso');
    fireEvent.change(input, { target: { value: 'Guardar el registro' } });
    fireEvent.submit(input.closest('form') as HTMLElement);
    await waitFor(() => expect(fetchMock.callsTo('/checklist').length).toBe(1));
    const call = fetchMock.callsTo('/checklist')[0];
    expect(call?.method).toBe('POST');
    expect(call?.body).toEqual({ content: 'Guardar el registro' });
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('marcar un paso hace PATCH { itemId, done }', async () => {
    await setup();
    const item = screen.getByText('Registrar el resultado').closest('li') as HTMLElement;
    fireEvent.click(within(item).getByLabelText('Marcar como hecho'));
    await waitFor(() => expect(fetchMock.callsTo('/checklist').length).toBe(1));
    expect(fetchMock.callsTo('/checklist')[0]?.body).toEqual({ itemId: 'c2', done: true });
  });

  it('desmarcar un paso ya hecho manda done false', async () => {
    await setup();
    const item = screen.getByText('Cargar el ciclo').closest('li') as HTMLElement;
    fireEvent.click(within(item).getByLabelText('Desmarcar'));
    await waitFor(() => expect(fetchMock.callsTo('/checklist').length).toBe(1));
    expect(fetchMock.callsTo('/checklist')[0]?.body).toEqual({ itemId: 'c1', done: false });
  });

  it('borrar un paso hace DELETE { itemId }', async () => {
    await setup();
    const item = screen.getByText('Cargar el ciclo').closest('li') as HTMLElement;
    fireEvent.click(within(item).getByLabelText('Quitar de la lista'));
    await waitFor(() => expect(fetchMock.callsTo('/checklist').length).toBe(1));
    const call = fetchMock.callsTo('/checklist')[0];
    expect(call?.method).toBe('DELETE');
    expect(call?.body).toEqual({ itemId: 'c1' });
  });

  it('comentar hace POST /comments y limpia el campo', async () => {
    await setup();
    const input = screen.getByPlaceholderText('Escribir un comentario…');
    fireEvent.change(input, { target: { value: 'Cerrado con el ciclo 42' } });
    fireEvent.submit(input.closest('form') as HTMLElement);
    await waitFor(() => expect(fetchMock.callsTo('/comments').length).toBe(1));
    expect(fetchMock.callsTo('/comments')[0]?.body).toEqual({ body: 'Cerrado con el ciclo 42' });
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('archivar hace DELETE de la tarea y cierra el panel', async () => {
    const { onClose, onChanged } = await setup();
    fireEvent.click(screen.getByLabelText('Archivar tarea'));
    await waitFor(() =>
      expect(fetchMock.calls.some((c) => c.url === '/api/tasks/d1' && c.method === 'DELETE')).toBe(
        true,
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onChanged).toHaveBeenCalled();
  });

  it('la nota de evidencia se guarda al salir del campo', async () => {
    await setup({
      task: detail({
        ...TASK,
        requiresEvidence: true,
        evidenceNote: null,
      }),
    });
    const area = screen.getByText('Evidencia para cerrar').parentElement as HTMLElement;
    const textarea = area.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Ciclo 42 correcto' } });
    fireEvent.blur(textarea);
    await waitFor(() => expect(lastPatch()?.body).toEqual({ evidenceNote: 'Ciclo 42 correcto' }));
  });
});

describe('TaskDetailPanel — cierre', () => {
  it('Escape cierra el panel', async () => {
    const { onClose } = await setup();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('el botón X y el fondo cierran el panel', async () => {
    const { onClose } = await setup();
    fireEvent.click(screen.getByLabelText('Cerrar'));
    fireEvent.click(screen.getByLabelText('Cerrar detalle'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('TaskDetailPanel — rol viewer', () => {
  it('no puede editar nada', async () => {
    const { container } = await setup({ canEdit: false });

    const title = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(title.readOnly).toBe(true);

    for (const sel of Array.from(container.querySelectorAll('select'))) {
      expect(sel.disabled).toBe(true);
    }
    expect(
      (container.querySelector('input[type="datetime-local"]') as HTMLInputElement).disabled,
    ).toBe(true);

    // responsables
    for (const m of MEMBERS) {
      expect(
        (screen.getByRole('button', { name: new RegExp(m.name) }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }

    // checklist: no se puede marcar, ni borrar, ni añadir
    expect((screen.getByLabelText('Marcar como hecho') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText('Quitar de la lista')).toBeNull();
    expect(screen.queryByPlaceholderText('Añadir paso')).toBeNull();

    // comentarios y archivado fuera de alcance
    expect(screen.queryByPlaceholderText('Escribir un comentario…')).toBeNull();
    expect(screen.queryByLabelText('Archivar tarea')).toBeNull();

    // y de hecho no se disparó ninguna escritura
    expect(fetchMock.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });
});
