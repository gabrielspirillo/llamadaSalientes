// Bloque 10 — Rutinas, automatizaciones y tratamientos postoperatorios.

import { RoutinesView } from '@/components/tasks/RoutinesView';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LUCIA, MEMBERS, mockFetch, rule, template } from './tasks-ui-fixtures';

afterEach(cleanup);

let fetchMock: ReturnType<typeof mockFetch>;
beforeEach(() => {
  fetchMock = mockFetch();
});

const POSTOP = [
  { id: 'tr1', name: 'Extracción', postOpFollowUp: true, postOpFollowUpHours: 24 },
  { id: 'tr2', name: 'Limpieza', postOpFollowUp: false, postOpFollowUpHours: 24 },
];

function setup(
  over: {
    templates?: ReturnType<typeof template>[];
    rules?: ReturnType<typeof rule>[];
    isAdmin?: boolean;
    postop?: typeof POSTOP;
  } = {},
) {
  fetchMock.on('/api/tasks/postop-treatments', {
    status: 200,
    json: { treatments: over.postop ?? POSTOP },
  });
  const onRefresh = vi.fn();
  render(
    <RoutinesView
      templates={over.templates ?? [template()]}
      rules={over.rules ?? [rule()]}
      members={MEMBERS}
      isAdmin={over.isAdmin ?? true}
      onRefresh={onRefresh}
    />,
  );
  return { onRefresh };
}

function templateCard(name: string): HTMLElement {
  return screen.getByRole('heading', { name, level: 3 }).closest('article') as HTMLElement;
}

describe('RoutinesView — rutinas recurrentes', () => {
  it('el switch dispara el PATCH de la plantilla', async () => {
    const { onRefresh } = setup();
    const card = templateCard('Apertura de clínica');
    const toggle = within(card).getByRole('checkbox') as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle);
    await waitFor(() => expect(fetchMock.callsTo('/api/tasks/templates/t-tpl-1').length).toBe(1));
    const call = fetchMock.callsTo('/api/tasks/templates/t-tpl-1')[0];
    expect(call?.method).toBe('PATCH');
    expect(call?.body).toEqual({ enabled: false });
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it('"Generar ahora" llama al endpoint de materialización', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Generar ahora/ }));
    await waitFor(() => expect(fetchMock.callsTo('/api/tasks/run-routines').length).toBe(1));
    expect(fetchMock.callsTo('/api/tasks/run-routines')[0]?.method).toBe('POST');
    expect(
      await screen.findByText('Listo: ya se han creado las tareas que tocaban.'),
    ).toBeTruthy();
  });

  it('un error del servidor se muestra y no se anuncia como éxito', async () => {
    fetchMock.on('/api/tasks/run-routines', { status: 500, json: { error: 'Cola caída' } });
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Generar ahora/ }));
    expect(await screen.findByText('Cola caída')).toBeTruthy();
    expect(screen.queryByText('Listo: ya se han creado las tareas que tocaban.')).toBeNull();
  });

  it('el % de cumplimiento sale de generadas vs. completadas', () => {
    cleanup();
    setup({
      templates: [
        template({ id: 'a', name: 'Alta', stats: { generated: 20, completed: 18 } }),
        template({ id: 'b', name: 'Media', stats: { generated: 20, completed: 12 } }),
        template({ id: 'c', name: 'Baja', stats: { generated: 3, completed: 1 } }),
        template({ id: 'd', name: 'Nueva', stats: { generated: 0, completed: 0 } }),
      ],
    });
    expect(within(templateCard('Alta')).getByText('90% cumplida').className).toContain(
      'text-emerald-600',
    );
    expect(within(templateCard('Media')).getByText('60% cumplida').className).toContain(
      'text-amber-600',
    );
    expect(within(templateCard('Baja')).getByText('33% cumplida').className).toContain(
      'text-red-600',
    );
    // sin instancias generadas no se inventa un porcentaje
    expect(within(templateCard('Nueva')).queryByText(/cumplida/)).toBeNull();
    expect(within(templateCard('Nueva')).getByText('0 generadas en 30 días')).toBeTruthy();
  });

  it('desplegar los pasos los muestra y permite cambiar hora y responsable', async () => {
    setup();
    const card = templateCard('Apertura de clínica');
    expect(within(card).queryByText('Encender el autoclave')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: /Ver los pasos/ }));
    expect(within(card).getByText('Encender el autoclave')).toBeTruthy();

    const time = card.querySelector('input[type="time"]') as HTMLInputElement;
    fireEvent.blur(time, { target: { value: '09:00' } });
    await waitFor(() => expect(fetchMock.callsTo('/api/tasks/templates/t-tpl-1').length).toBe(1));
    expect(fetchMock.callsTo('/api/tasks/templates/t-tpl-1')[0]?.body).toEqual({
      dueTime: '09:00',
    });

    const select = within(card).getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: LUCIA.userId } });
    await waitFor(() => expect(fetchMock.callsTo('/api/tasks/templates/t-tpl-1').length).toBe(2));
    expect(fetchMock.callsTo('/api/tasks/templates/t-tpl-1')[1]?.body).toEqual({
      defaultAssigneeUserId: LUCIA.userId,
    });
  });
});

describe('RoutinesView — automatizaciones', () => {
  it('el switch dispara el PATCH de la regla', async () => {
    setup();
    const toggle = screen.getByLabelText('Activar regla Llamada perdida') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() => expect(fetchMock.callsTo('/api/tasks/automations/r-1').length).toBe(1));
    const call = fetchMock.callsTo('/api/tasks/automations/r-1')[0];
    expect(call?.method).toBe('PATCH');
    expect(call?.body).toEqual({ enabled: false });
  });

  it('ajustar título, plazo y responsable manda el cuerpo correcto', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Ajustar/ }));

    const title = screen.getByDisplayValue('Devolver llamada a {{patientName}}');
    fireEvent.blur(title, { target: { value: 'Llamar a {{patientName}} ya  ' } });
    await waitFor(() => expect(fetchMock.callsTo('/api/tasks/automations/r-1').length).toBe(1));
    expect(fetchMock.callsTo('/api/tasks/automations/r-1')[0]?.body).toEqual({
      titleTemplate: 'Llamar a {{patientName}} ya',
    });

    const offset = screen.getByDisplayValue('120');
    fireEvent.blur(offset, { target: { value: '45' } });
    await waitFor(() => expect(fetchMock.callsTo('/api/tasks/automations/r-1').length).toBe(2));
    expect(fetchMock.callsTo('/api/tasks/automations/r-1')[1]?.body).toEqual({
      dueOffsetMinutes: 45,
    });
  });

  it('el plazo se acota al rango permitido', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Ajustar/ }));
    fireEvent.blur(screen.getByDisplayValue('120'), { target: { value: '1' } });
    await waitFor(() => expect(fetchMock.callsTo('/api/tasks/automations/r-1').length).toBe(1));
    expect(fetchMock.callsTo('/api/tasks/automations/r-1')[0]?.body).toEqual({
      dueOffsetMinutes: 5,
    });
  });

  it('la regla de paciente inactivo expone los meses', async () => {
    setup({ rules: [rule({ id: 'r-inact', trigger: 'PATIENT_INACTIVE', params: {} })] });
    fireEvent.click(screen.getByRole('button', { name: /Ajustar/ }));
    const months = screen.getByDisplayValue('12');
    fireEvent.blur(months, { target: { value: '18' } });
    await waitFor(() => expect(fetchMock.callsTo('/api/tasks/automations/r-inact').length).toBe(1));
    expect(fetchMock.callsTo('/api/tasks/automations/r-inact')[0]?.body).toEqual({
      params: { inactiveMonths: 18 },
    });
  });
});

describe('RoutinesView — tratamientos postoperatorios', () => {
  it('carga la lista y marca los que ya llevan seguimiento', async () => {
    setup();
    expect(await screen.findByText('Extracción')).toBeTruthy();
    const extraccion = screen.getByText('Extracción').closest('label') as HTMLElement;
    expect((within(extraccion).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    const limpieza = screen.getByText('Limpieza').closest('label') as HTMLElement;
    expect((within(limpieza).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('activar uno manda el PATCH y pinta el cambio al instante', async () => {
    setup();
    await screen.findByText('Limpieza');
    const limpieza = screen.getByText('Limpieza').closest('label') as HTMLElement;
    fireEvent.click(within(limpieza).getByRole('checkbox'));

    await waitFor(() =>
      expect(
        fetchMock.calls.some(
          (c) => c.url.includes('/api/tasks/postop-treatments') && c.method === 'PATCH',
        ),
      ).toBe(true),
    );
    const patch = fetchMock.calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({ treatmentId: 'tr2', postOpFollowUp: true });
    expect((within(limpieza).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });
});

describe('RoutinesView — permisos', () => {
  it('un no-admin no puede tocar nada', async () => {
    setup({ isAdmin: false });
    expect(screen.queryByRole('button', { name: /Generar ahora/ })).toBeNull();
    expect(
      (within(templateCard('Apertura de clínica')).getByRole('checkbox') as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText('Activar regla Llamada perdida') as HTMLInputElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole('button', { name: /Ajustar/ })).toBeNull();

    await screen.findByText('Extracción');
    const extraccion = screen.getByText('Extracción').closest('label') as HTMLElement;
    expect((within(extraccion).getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  });
});
