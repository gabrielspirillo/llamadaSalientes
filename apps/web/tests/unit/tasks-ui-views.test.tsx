// Bloque 7 — Vistas Mi día, Semana y Pacientes.

import { MyDayView, PatientsView, WeekView } from '@/components/tasks/views';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LUCIA, MARTA, MEMBERS, task } from './tasks-ui-fixtures';

vi.mock('next/link', () => ({
  default: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}));

afterEach(cleanup);

// Miércoles 2 de septiembre de 2026, 12:00 hora local.
const NOW = new Date(2026, 8, 2, 12, 0, 0);
const iso = (...a: [number, number, number, number?, number?]) =>
  new Date(a[0], a[1], a[2], a[3] ?? 0, a[4] ?? 0).toISOString();

function groupOf(title: string): HTMLElement {
  return screen.getByRole('heading', { name: title, level: 2 }).closest('section') as HTMLElement;
}

describe('MyDayView — agrupación', () => {
  const TASKS = [
    task({ id: 'v', title: 'Vencida ayer', dueAt: iso(2026, 8, 1, 10) }),
    task({ id: 'v2', title: 'Vencida esta mañana', dueAt: iso(2026, 8, 2, 9) }),
    task({ id: 'h', title: 'Para esta tarde', dueAt: iso(2026, 8, 2, 18) }),
    task({ id: 's', title: 'Sin fecha ninguna', dueAt: null }),
    task({ id: 'p', title: 'La semana que viene', dueAt: iso(2026, 8, 7, 10) }),
    task({
      id: 'd',
      title: 'Ya cerrada hoy',
      status: 'DONE',
      completedAt: iso(2026, 8, 2, 11),
    }),
  ];

  function renderDay(onlyMine = true, tasks = TASKS, currentUserId: string | null = LUCIA.userId) {
    const onToggleMine = vi.fn();
    render(
      <MyDayView
        tasks={tasks}
        members={MEMBERS}
        now={NOW}
        canEdit
        currentUserId={currentUserId}
        onlyMine={onlyMine}
        onToggleMine={onToggleMine}
        onOpen={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    return { onToggleMine };
  }

  it('reparte en Vencidas / Para hoy / Sin fecha / Próximas', () => {
    renderDay();
    expect(within(groupOf('Vencidas')).getByText('Vencida ayer')).toBeTruthy();
    expect(within(groupOf('Vencidas')).getByText('Vencida esta mañana')).toBeTruthy();
    expect(within(groupOf('Para hoy')).getByText('Para esta tarde')).toBeTruthy();
    expect(within(groupOf('Sin fecha')).getByText('Sin fecha ninguna')).toBeTruthy();
    expect(within(groupOf('Próximas')).getByText('La semana que viene')).toBeTruthy();
    expect(within(groupOf('Cerradas hoy')).getByText('Ya cerrada hoy')).toBeTruthy();
  });

  it('los contadores por grupo cuadran y el resumen suma solo lo abierto', () => {
    renderDay();
    expect(within(groupOf('Vencidas')).getAllByRole('listitem')).toHaveLength(2);
    expect(within(groupOf('Para hoy')).getAllByRole('listitem')).toHaveLength(1);
    // 5 abiertas + 1 cerrada hoy
    expect(screen.getByText('5 pendientes · 1 cerrada hoy')).toBeTruthy();
  });

  it('un grupo sin tareas no se pinta', () => {
    renderDay(true, [task({ id: 'u', title: 'Solo esta', dueAt: null })]);
    expect(screen.queryByRole('heading', { name: 'Vencidas', level: 2 })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Sin fecha', level: 2 })).toBeTruthy();
  });

  it('"Lo mío" filtra por responsable; "Toda la clínica" muestra todo', () => {
    const tasks = [
      task({ id: 'mia', title: 'Mía', assigneeIds: [LUCIA.userId], dueAt: null }),
      task({ id: 'suya', title: 'De Marta', assigneeIds: [MARTA.userId], dueAt: null }),
      task({ id: 'nadie', title: 'De nadie', assigneeIds: [], dueAt: null }),
    ];
    renderDay(true, tasks);
    expect(screen.getByText('Mía')).toBeTruthy();
    expect(screen.queryByText('De Marta')).toBeNull();
    // las que no tiene nadie se consideran de todos
    expect(screen.getByText('De nadie')).toBeTruthy();

    cleanup();
    renderDay(false, tasks);
    expect(screen.getByText('Mía')).toBeTruthy();
    expect(screen.getByText('De Marta')).toBeTruthy();
  });

  it('los botones del selector avisan del cambio', () => {
    const { onToggleMine } = renderDay(true);
    fireEvent.click(screen.getByRole('button', { name: 'Toda la clínica' }));
    expect(onToggleMine).toHaveBeenCalledWith(false);
  });

  it('sin nada abierto muestra el estado vacío', () => {
    renderDay(true, []);
    expect(screen.getByText('Día limpio')).toBeTruthy();
    expect(screen.getByText('Nada pendiente')).toBeTruthy();
  });
});

describe('WeekView — reparto por día', () => {
  // Semana del lunes 31/08/2026 al domingo 06/09/2026.
  const TASKS = [
    task({ id: 'lun', title: 'Del lunes', dueAt: iso(2026, 7, 31, 9) }),
    task({ id: 'mie', title: 'Del miércoles', dueAt: iso(2026, 8, 2, 16) }),
    task({ id: 'dom', title: 'Del domingo', dueAt: iso(2026, 8, 6, 23, 30) }),
    task({ id: 'next', title: 'Del lunes que viene', dueAt: iso(2026, 8, 7, 9) }),
    task({ id: 'prev', title: 'Del domingo pasado', dueAt: iso(2026, 7, 30, 9) }),
    task({ id: 'nofecha', title: 'Tarea sin fecha', dueAt: null }),
  ];

  function dayCell(dayNumber: string): HTMLElement {
    const grid = document.querySelector('.grid') as HTMLElement;
    const cells = Array.from(grid.children) as HTMLElement[];
    const cell = cells.find(
      (c) => c.querySelector('span:last-of-type')?.textContent === dayNumber,
    );
    if (!cell) throw new Error(`sin celda para el día ${dayNumber}`);
    return cell;
  }

  function renderWeek(tasks = TASKS) {
    render(
      <WeekView
        tasks={tasks}
        members={MEMBERS}
        now={NOW}
        canEdit
        onOpen={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
  }

  it('la semana arranca en lunes y cubre 7 días', () => {
    renderWeek([]);
    const grid = document.querySelector('.grid') as HTMLElement;
    expect(grid.children).toHaveLength(7);
    const numbers = Array.from(grid.children).map(
      (c) => (c as HTMLElement).querySelector('span:last-of-type')?.textContent,
    );
    expect(numbers).toEqual(['31', '1', '2', '3', '4', '5', '6']);
  });

  it('coloca cada tarea en su día', () => {
    renderWeek();
    expect(within(dayCell('31')).getByText('Del lunes')).toBeTruthy();
    expect(within(dayCell('2')).getByText('Del miércoles')).toBeTruthy();
    expect(within(dayCell('6')).getByText('Del domingo')).toBeTruthy();
  });

  it('lo de fuera de la semana no aparece en ningún día', () => {
    renderWeek();
    const grid = document.querySelector('.grid') as HTMLElement;
    expect(within(grid).queryByText('Del lunes que viene')).toBeNull();
    expect(within(grid).queryByText('Del domingo pasado')).toBeNull();
  });

  it('las tareas sin fecha van a su propia sección, no a un día', () => {
    renderWeek();
    const grid = document.querySelector('.grid') as HTMLElement;
    expect(within(grid).queryByText('Tarea sin fecha')).toBeNull();
    const section = screen.getByRole('heading', { level: 2 }).closest('section') as HTMLElement;
    expect(within(section).getByText('Tarea sin fecha')).toBeTruthy();
  });

  it('marca el día de hoy', () => {
    renderWeek([]);
    expect(dayCell('2').className).toContain('bg-zinc-50');
    expect(dayCell('3').className).not.toContain('bg-zinc-50');
  });
});

describe('PatientsView — agrupación por paciente', () => {
  const TASKS = [
    task({
      id: 'p1a',
      title: 'Devolver llamada',
      patientGhlContactId: 'ghl-1',
      patientName: 'María Gómez',
      patientPhone: '+34600111222',
      dueAt: iso(2026, 8, 4, 10),
    }),
    task({
      id: 'p1b',
      title: 'Enviar presupuesto',
      patientGhlContactId: 'ghl-1',
      patientName: 'María Gómez',
      patientPhone: null,
      dueAt: iso(2026, 8, 9, 10),
    }),
    task({
      id: 'p2',
      title: 'Reagendar cita',
      patientGhlContactId: 'ghl-2',
      patientName: 'Juan Pérez',
      dueAt: iso(2026, 8, 3, 10),
    }),
    task({ id: 'sin', title: 'Cuadrar caja' }),
    task({
      id: 'cerrada',
      title: 'Ya hecha',
      status: 'DONE',
      patientGhlContactId: 'ghl-3',
      patientName: 'Ana Cerrada',
    }),
  ];

  function renderPatients(tasks = TASKS) {
    render(
      <PatientsView
        tasks={tasks}
        members={MEMBERS}
        now={NOW}
        canEdit
        onOpen={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
  }

  it('agrupa por paciente y deja fuera lo que no es de paciente ni lo cerrado', () => {
    renderPatients();
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent?.trim());
    expect(headings).toEqual(['Juan Pérez', 'María Gómez']);
    expect(screen.queryByText('Cuadrar caja')).toBeNull();
    expect(screen.queryByText('Ya hecha')).toBeNull();
    expect(screen.getByText('2 pacientes con algo pendiente · 3 tareas')).toBeTruthy();
  });

  it('ordena por el vencimiento más próximo', () => {
    renderPatients();
    const names = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.trim());
    // Juan vence el día 3, María el 4
    expect(names[0]).toBe('Juan Pérez');
  });

  it('junta las dos tareas del mismo paciente y hereda el teléfono', () => {
    renderPatients();
    const section = screen
      .getByRole('heading', { name: 'María Gómez', level: 2 })
      .closest('section') as HTMLElement;
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
    expect(within(section).getByText('2 pendientes')).toBeTruthy();
    // el teléfono viene de la primera tarea que lo trae
    expect(within(section).getAllByText('+34600111222').length).toBeGreaterThan(0);
  });

  it('sin pacientes pendientes muestra el estado vacío', () => {
    renderPatients([task({ id: 'solo', title: 'Interna' })]);
    expect(screen.getByText('Ningún paciente esperando')).toBeTruthy();
  });
});
