// Bloque 5 — Alta rápida.

import { QuickAdd } from '@/components/tasks/QuickAdd';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARTA, PEDRO, member, mockFetch } from './tasks-ui-fixtures';

afterEach(cleanup);

let fetchMock: ReturnType<typeof mockFetch>;
beforeEach(() => {
  fetchMock = mockFetch();
});

// Un miembro cuyo email empieza por el alias, para el match por email.
const ANA = member({
  userId: 'u-ana',
  name: 'Ana Ruiz',
  initials: 'AR',
  email: 'ana@clinica.test',
});

function setup(members = [MARTA, PEDRO, ANA]) {
  const onCreated = vi.fn();
  const onCancel = vi.fn();
  render(
    <QuickAdd
      members={members}
      status="TODO"
      onCreated={onCreated}
      onCancel={onCancel}
      autoFocus={false}
    />,
  );
  const input = screen.getByPlaceholderText(/Llamar a María/);
  return { input, onCreated, onCancel };
}

function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

describe('QuickAdd — vista previa', () => {
  it('refleja categoría, prioridad, fecha, asignado y etiquetas', () => {
    const { input } = setup();
    type(input, 'Llamar a Maria mañana 10:30 #paciente #revision !alta @marta');

    expect(screen.getByText('Paciente')).toBeTruthy();
    expect(screen.getByText('Alta')).toBeTruthy();
    expect(screen.getByText(/vence mañana 10:30/)).toBeTruthy();
    expect(screen.getByText('Marta')).toBeTruthy();
    expect(screen.getByText('#revision')).toBeTruthy();
  });

  it('sin nada que parsear no muestra la vista previa', () => {
    const { input } = setup();
    type(input, 'Pedir material');
    expect(screen.queryByText('Paciente')).toBeNull();
    expect(screen.queryByText(/vence /)).toBeNull();
  });

  it('resuelve el alias por email además de por nombre', () => {
    const { input } = setup();
    type(input, 'Repasar agenda @ana');
    expect(screen.getByText('Ana Ruiz')).toBeTruthy();
  });

  it('!!! sin palabra se lee como urgente', () => {
    const { input } = setup();
    type(input, 'Reponer anestesia !!!');
    expect(screen.getByText('Urgente')).toBeTruthy();
  });
});

describe('QuickAdd — envío', () => {
  it('arma el POST con el payload parseado', async () => {
    fetchMock.on('/api/tasks', { status: 201, json: { id: 'nueva' } });
    const { input, onCreated } = setup();
    type(input, 'Llamar a Maria mañana 10:30 #paciente #revision !alta @marta');
    fireEvent.submit(screen.getByRole('button', { name: 'Crear' }).closest('form') as HTMLElement);

    await waitFor(() => expect(fetchMock.callsTo('/api/tasks').length).toBe(1));
    const call = fetchMock.callsTo('/api/tasks')[0];
    expect(call?.method).toBe('POST');
    const body = call?.body as Record<string, unknown>;
    expect(body.title).toBe('Llamar a Maria');
    expect(body.status).toBe('TODO');
    expect(body.category).toBe('PATIENT');
    expect(body.priority).toBe('HIGH');
    expect(body.labels).toEqual(['revision']);
    expect(body.assigneeUserIds).toEqual([MARTA.userId]);
    expect(body.dueAllDay).toBe(false);
    const due = new Date(String(body.dueAt));
    expect(due.getHours()).toBe(10);
    expect(due.getMinutes()).toBe(30);

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('omite los campos que el parser no encontró', async () => {
    fetchMock.on('/api/tasks', { status: 201, json: { id: 'x' } });
    const { input } = setup();
    type(input, 'Pedir guantes');
    fireEvent.submit(screen.getByRole('button', { name: 'Crear' }).closest('form') as HTMLElement);

    await waitFor(() => expect(fetchMock.callsTo('/api/tasks').length).toBe(1));
    const body = fetchMock.callsTo('/api/tasks')[0]?.body as Record<string, unknown>;
    expect(body.title).toBe('Pedir guantes');
    expect('category' in body).toBe(false);
    expect('priority' in body).toBe(false);
    expect('dueAt' in body).toBe(false);
    expect('assigneeUserIds' in body).toBe(false);
  });

  it('el botón está deshabilitado sin título y activo con él', () => {
    const { input } = setup();
    const btn = screen.getByRole('button', { name: 'Crear' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // solo metadatos, sin texto: sigue sin poder crearse
    type(input, '#paciente !alta');
    expect((screen.getByRole('button', { name: 'Crear' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    type(input, 'Algo que hacer');
    expect((screen.getByRole('button', { name: 'Crear' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('Escape cancela', () => {
    const { input, onCancel } = setup();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('muestra el error del servidor y no limpia lo escrito', async () => {
    fetchMock.on('/api/tasks', { status: 409, json: { error: 'La tarea ya existía' } });
    const { input, onCreated } = setup();
    type(input, 'Duplicada');
    fireEvent.submit(screen.getByRole('button', { name: 'Crear' }).closest('form') as HTMLElement);

    await waitFor(() => expect(screen.getByText('La tarea ya existía')).toBeTruthy());
    expect(onCreated).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe('Duplicada');
  });
});

describe('QuickAdd — HALLAZGO: el alias no ignora las tildes', () => {
  // El placeholder del propio campo propone "@lucia", pero el match es
  // `name.toLowerCase().startsWith(hint)` sin normalizar diacríticos
  // (QuickAdd.tsx:41-49). Con una compañera llamada "Lucía" el alias no
  // resuelve: la vista previa no muestra a nadie y la tarea se crea sin
  // responsable, sin ningún aviso. Este test describe lo esperado; hoy FALLA.
  it('@lucia resuelve a Lucía', () => {
    const LUCIA = member({
      userId: 'u-lucia',
      name: 'Lucía',
      initials: 'LU',
      email: 'lperez@clinica.test',
    });
    const { input } = setup([LUCIA]);
    type(input, 'Llamar a Maria @lucia');
    expect(screen.getByText('Lucía')).toBeTruthy();
  });
});
