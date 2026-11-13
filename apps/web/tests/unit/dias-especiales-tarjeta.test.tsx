import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const saveSpecialDayAction = vi.fn();
const deleteSpecialDayAction = vi.fn();
vi.mock('@/app/(dashboard)/dashboard/settings/special-days-actions', () => ({
  saveSpecialDayAction: (...a: unknown[]) => saveSpecialDayAction(...a),
  deleteSpecialDayAction: (...a: unknown[]) => deleteSpecialDayAction(...a),
}));

import { SpecialDaysCard } from '@/app/(dashboard)/dashboard/settings/special-days-card';

afterEach(() => {
  cleanup();
  saveSpecialDayAction.mockReset();
});

const RAQUEL = {
  id: '22222222-2222-2222-2222-222222222222',
  fullName: 'Raquel',
  shifts: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 900, endMinute: 1200 })),
};

function renderCard(days = []) {
  return render(
    <SpecialDaysCard
      canEdit
      professionals={[RAQUEL]}
      days={days}
      todayKey="2026-11-13"
      clinicClosedWeekdays={[6, 7]}
    />,
  );
}

describe('tarjeta "Días con horario especial"', () => {
  it('al elegir un martes propone mañana 9-13 y la tarde habitual (15-20) y lo guarda', async () => {
    saveSpecialDayAction.mockResolvedValue({ ok: true, outside: 0, summary: 'x' });
    renderCard();
    fireEvent.change(screen.getByLabelText('Día'), { target: { value: '2026-11-17' } });
    expect(screen.getByText(/de 9:00 a 13:00 y de 15:00 a 20:00/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Guardar día especial/ }));
    await waitFor(() => expect(saveSpecialDayAction).toHaveBeenCalled());
    expect(saveSpecialDayAction.mock.calls[0]?.[0]).toMatchObject({
      day: '2026-11-17',
      professionalIds: [RAQUEL.id],
      ranges: [
        { start: 540, end: 780 },
        { start: 900, end: 1200 },
      ],
    });
  });

  it('un sábado (normalmente cerrado) propone sólo la mañana y lo avisa', () => {
    renderCard();
    fireEvent.change(screen.getByLabelText('Día'), { target: { value: '2026-11-21' } });
    expect(screen.getByText(/normalmente no abre/)).toBeTruthy();
    expect(screen.getByText('Esa tarde no trabaja')).toBeTruthy();
    expect(screen.getByText('de 9:00 a 13:00')).toBeTruthy();
  });

  it('sin mañana ni tarde no deja guardar', () => {
    renderCard();
    fireEvent.change(screen.getByLabelText('Día'), { target: { value: '2026-11-17' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Abre por la mañana' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Esa tarde también trabaja' }));
    expect(screen.getByText(/Marca la mañana, la tarde o las dos/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /Guardar día especial/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('avisa de las citas que quedan fuera del nuevo horario', async () => {
    saveSpecialDayAction.mockResolvedValue({ ok: true, outside: 2, summary: 'x' });
    renderCard();
    fireEvent.change(screen.getByLabelText('Día'), { target: { value: '2026-11-17' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Esa tarde también trabaja' }));
    fireEvent.click(screen.getByRole('button', { name: /Guardar día especial/ }));
    expect(await screen.findByText(/hay 2 citas fuera de este horario/)).toBeTruthy();
  });
});
