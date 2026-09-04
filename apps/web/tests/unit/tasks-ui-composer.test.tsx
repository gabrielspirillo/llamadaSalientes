// Bloque 12 — Alta de tarea completa (TaskComposer).

import { TaskComposer } from '@/components/tasks/TaskComposer';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LUCIA, MEMBERS, mockFetch } from './tasks-ui-fixtures';

afterEach(cleanup);

let fetchMock: ReturnType<typeof mockFetch>;
beforeEach(() => {
  fetchMock = mockFetch();
  fetchMock.on('/api/tasks', { status: 201, json: { id: 't-new' } });
});

function open(initialText?: string) {
  const onCreated = vi.fn();
  render(
    <TaskComposer
      open
      onOpenChange={vi.fn()}
      members={MEMBERS}
      defaultStatus="TODO"
      initialText={initialText}
      onCreated={onCreated}
    />,
  );
  return { onCreated };
}

describe('TaskComposer', () => {
  it('arma el POST con todo: pasos, responsable, etiqueta y evidencia', async () => {
    const { onCreated } = open();

    fireEvent.change(screen.getByLabelText('Título'), {
      target: { value: 'Revisar esterilización' },
    });
    fireEvent.change(screen.getByLabelText('Descripción'), {
      target: { value: 'Ciclo del autoclave' },
    });

    // Un paso.
    fireEvent.change(screen.getByLabelText('Nuevo paso'), { target: { value: 'Anotar ciclo' } });
    fireEvent.keyDown(screen.getByLabelText('Nuevo paso'), { key: 'Enter' });
    expect(screen.getByDisplayValue('Anotar ciclo')).toBeTruthy();

    // Una etiqueta.
    fireEvent.change(screen.getByLabelText('Nueva etiqueta'), { target: { value: 'urgente' } });
    fireEvent.keyDown(screen.getByLabelText('Nueva etiqueta'), { key: 'Enter' });
    expect(screen.getByText('#urgente')).toBeTruthy();

    // Un responsable.
    fireEvent.click(screen.getByRole('button', { name: /Lucía/ }));

    // Evidencia.
    fireEvent.click(screen.getByRole('switch', { name: 'Exigir evidencia' }));

    fireEvent.click(screen.getByRole('button', { name: /Crear tarea/ }));

    await waitFor(() => expect(fetchMock.callsTo('/api/tasks').length).toBe(1));
    const body = fetchMock.callsTo('/api/tasks')[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      title: 'Revisar esterilización',
      description: 'Ciclo del autoclave',
      status: 'TODO',
      priority: 'MEDIUM',
      requiresEvidence: true,
      labels: ['urgente'],
      assigneeUserIds: [LUCIA.userId],
      checklist: ['Anotar ciclo'],
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('sin título el botón está desactivado y no envía', () => {
    open();
    const create = screen.getByRole('button', { name: /Crear tarea/ }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(fetchMock.callsTo('/api/tasks').length).toBe(0);
  });

  it('vincular paciente manda nombre y teléfono', async () => {
    open();
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Llamar' } });
    fireEvent.click(screen.getByRole('button', { name: /Vincular un paciente/ }));
    fireEvent.change(screen.getByLabelText('Paciente'), { target: { value: 'María López' } });
    fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '+34600111222' } });
    fireEvent.click(screen.getByRole('button', { name: /Crear tarea/ }));

    await waitFor(() => expect(fetchMock.callsTo('/api/tasks').length).toBe(1));
    const body = fetchMock.callsTo('/api/tasks')[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ patientName: 'María López', patientPhone: '+34600111222' });
  });

  it('prefill desde el alta rápida: título, categoría y prioridad', () => {
    open('Llamar a María #paciente !alta');
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Llamar a María');
    expect((screen.getByLabelText('Categoría') as HTMLSelectElement).value).toBe('PATIENT');
    expect((screen.getByLabelText('Prioridad') as HTMLSelectElement).value).toBe('HIGH');
  });
});
