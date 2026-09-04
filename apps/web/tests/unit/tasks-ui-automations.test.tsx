// Bloque 11 — Constructor de automatizaciones a medida y fila de reglas.

import { AutomationBuilder } from '@/components/tasks/AutomationBuilder';
import { RoutinesView } from '@/components/tasks/RoutinesView';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEMBERS, mockFetch, rule, template } from './tasks-ui-fixtures';

afterEach(cleanup);

let fetchMock: ReturnType<typeof mockFetch>;
beforeEach(() => {
  fetchMock = mockFetch();
  fetchMock.on('/api/tasks/postop-treatments', { status: 200, json: { treatments: [] } });
});

// ─── Fila de regla a medida ────────────────────────────────────────────────

describe('RuleRow — regla a medida', () => {
  const custom = rule({
    id: 'r-custom',
    name: 'Devolver llamada VIP',
    isSystem: false,
    trigger: 'MISSED_CALL',
    conditions: [{ field: 'patientName', op: 'contains', value: 'García' }],
  });

  function setup(isAdmin = true) {
    render(
      <RoutinesView
        templates={[template()]}
        rules={[custom]}
        members={MEMBERS}
        isAdmin={isAdmin}
        onRefresh={vi.fn()}
      />,
    );
  }

  it('muestra el nombre, el sello "A medida" y el resumen de condiciones', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Devolver llamada VIP', level: 3 })).toBeTruthy();
    expect(screen.getByText('A medida')).toBeTruthy();
    expect(screen.getByText(/Nombre del paciente contiene «García»/)).toBeTruthy();
  });

  it('eliminar pide confirmación y luego llama al DELETE', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Eliminar/ }));
    // No dispara nada hasta confirmar.
    expect(fetchMock.callsTo('/api/tasks/automations/r-custom').length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: /Sí, eliminar/ }));
    await waitFor(() =>
      expect(fetchMock.callsTo('/api/tasks/automations/r-custom').length).toBe(1),
    );
    expect(fetchMock.callsTo('/api/tasks/automations/r-custom')[0]?.method).toBe('DELETE');
  });

  it('una regla a medida no ofrece el "Ajustar" en línea del catálogo', () => {
    setup();
    expect(screen.queryByRole('button', { name: /Ajustar/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Editar/ })).toBeTruthy();
  });

  it('un no-admin no ve ni editar ni eliminar', () => {
    setup(false);
    expect(screen.queryByRole('button', { name: /Editar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Eliminar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Nueva automatización/ })).toBeNull();
  });
});

// ─── Constructor ────────────────────────────────────────────────────────────

describe('AutomationBuilder — crear', () => {
  it('arma el POST con evento, nombre y condición', async () => {
    fetchMock.on('/api/tasks/automations', { status: 201, json: { rules: [] } });
    const onSaved = vi.fn();
    render(
      <AutomationBuilder
        open
        onOpenChange={vi.fn()}
        members={MEMBERS}
        rule={null}
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText('Nombre'), {
      target: { value: 'Aviso implantes' },
    });
    fireEvent.change(screen.getByLabelText('Cuando ocurre'), {
      target: { value: 'POST_TREATMENT_FOLLOWUP' },
    });
    fireEvent.change(screen.getByLabelText('Título de la tarea'), {
      target: { value: 'Llamar a {{patientName}} por su implante' },
    });

    // Una condición: tratamiento contiene "implante".
    fireEvent.click(screen.getByRole('button', { name: /Añadir/ }));
    fireEvent.change(screen.getByLabelText('Campo'), { target: { value: 'treatment' } });
    fireEvent.change(screen.getByLabelText('Valor'), { target: { value: 'implante' } });

    fireEvent.click(screen.getByRole('button', { name: /Crear automatización/ }));

    await waitFor(() => expect(fetchMock.callsTo('/api/tasks/automations').length).toBe(1));
    const call = fetchMock.callsTo('/api/tasks/automations')[0];
    expect(call?.method).toBe('POST');
    expect(call?.body).toMatchObject({
      trigger: 'POST_TREATMENT_FOLLOWUP',
      name: 'Aviso implantes',
      titleTemplate: 'Llamar a {{patientName}} por su implante',
      conditions: [{ field: 'treatment', op: 'contains', value: 'implante' }],
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('no envía si falta el nombre', async () => {
    fetchMock.on('/api/tasks/automations', { status: 201, json: { rules: [] } });
    render(
      <AutomationBuilder
        open
        onOpenChange={vi.fn()}
        members={MEMBERS}
        rule={null}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Crear automatización/ }));
    expect(await screen.findByText(/Ponle un nombre/)).toBeTruthy();
    expect(fetchMock.callsTo('/api/tasks/automations').length).toBe(0);
  });
});

describe('AutomationBuilder — editar', () => {
  const existing = rule({
    id: 'r-edit',
    name: 'Regla vieja',
    isSystem: false,
    trigger: 'APPOINTMENT_CANCELLED',
  });

  it('el evento no se puede cambiar y guarda con PATCH', async () => {
    fetchMock.on('/api/tasks/automations/r-edit', { status: 200, json: { rules: [] } });
    render(
      <AutomationBuilder
        open
        onOpenChange={vi.fn()}
        members={MEMBERS}
        rule={existing}
        onSaved={vi.fn()}
      />,
    );

    expect((screen.getByLabelText('Cuando ocurre') as HTMLSelectElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Regla nueva' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }));

    await waitFor(() => expect(fetchMock.callsTo('/api/tasks/automations/r-edit').length).toBe(1));
    const call = fetchMock.callsTo('/api/tasks/automations/r-edit')[0];
    expect(call?.method).toBe('PATCH');
    expect((call?.body as { name?: string; trigger?: string }).name).toBe('Regla nueva');
    expect((call?.body as { trigger?: string }).trigger).toBeUndefined();
  });
});
