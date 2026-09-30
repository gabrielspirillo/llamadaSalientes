import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const voidInvoiceAction = vi.fn();
vi.mock('@/app/(dashboard)/dashboard/agenda/actions', () => ({
  issueInvoiceAction: vi.fn(),
  sendInvoiceWhatsappAction: vi.fn(),
  voidInvoiceAction: (...args: unknown[]) => voidInvoiceAction(...args),
}));

import { InvoicesCard } from '@/components/agenda/invoices-card';

afterEach(cleanup);

const INVOICE = '91dc4aa4-a0bc-4937-b8d2-d36661fe5569';

function renderCard() {
  const promptSpy = vi.spyOn(window, 'prompt');
  render(
    <InvoicesCard
      invoices={[
        {
          id: INVOICE,
          number: '2026-0000001',
          issuedOnLabel: '30 sept 2026',
          totalCents: 3000,
          status: 'ISSUED',
          billToName: 'Adrian Ortiz',
          billToPhone: null,
          billToEmail: null,
          paymentMethod: 'CASH',
          whatsappSentAt: null,
          itemsSummary: '1× Tratamiento X',
        },
      ]}
      canWrite
      canVoid
      dialog={{
        patientKey: 'pat:1',
        patientId: null,
        patientName: 'Adrian Ortiz',
        clinicName: 'Respinens',
        issuerName: 'Raquel Pinto Egea',
        vatRate: 0,
        defaults: { name: 'Adrian Ortiz', taxId: null, address: null, email: null, phone: null },
        candidates: [],
        todayKey: '2026-09-30',
      }}
    />,
  );
  return { promptSpy };
}

describe('anular una factura', () => {
  it('abre el diálogo del panel (no el prompt del navegador) y exige motivo', async () => {
    voidInvoiceAction.mockResolvedValue({ ok: true });
    const { promptSpy } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Anular/ }));
    expect(promptSpy).not.toHaveBeenCalled();
    expect(screen.getByText('¿Anular la factura 2026-0000001?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Anular factura' }));
    expect(await screen.findByText(/Escribe el motivo/)).toBeTruthy();
    expect(voidInvoiceAction).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Motivo de la anulación/), {
      target: { value: 'Datos del tutor equivocados' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Anular factura' }));
    await waitFor(() =>
      expect(voidInvoiceAction).toHaveBeenCalledWith(INVOICE, 'Datos del tutor equivocados'),
    );
    await waitFor(() => expect(screen.getByText('Factura 2026-0000001 anulada.')).toBeTruthy());
  });

  it('si el servidor falla, el error sale dentro del diálogo', async () => {
    voidInvoiceAction.mockResolvedValue({ ok: false, error: 'Esa factura ya está anulada.' });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Anular/ }));
    fireEvent.change(screen.getByLabelText(/Motivo de la anulación/), {
      target: { value: 'Prueba' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Anular factura' }));
    expect(await screen.findByText('Esa factura ya está anulada.')).toBeTruthy();
    expect(screen.getByText('¿Anular la factura 2026-0000001?')).toBeTruthy();
  });
});
