import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const issueInvoiceAction = vi.fn();
vi.mock('@/app/(dashboard)/dashboard/agenda/actions', () => ({
  issueInvoiceAction: (...args: unknown[]) => issueInvoiceAction(...args),
  sendInvoiceWhatsappAction: vi.fn(),
}));

import { InvoiceDialog, type InvoiceDialogProps } from '@/components/agenda/invoice-dialog';
import { invoicePublicPath, signInvoiceLink, verifyInvoiceLink } from '@/lib/invoices/public-link';

afterEach(cleanup);

const TENANT = '11111111-1111-1111-1111-111111111111';
const INVOICE = '91dc4aa4-a0bc-4937-b8d2-d36661fe5569';

describe('enlace público del PDF', () => {
  it('firma y verifica, y caduca', () => {
    const exp = 2_000_000_000;
    const sig = signInvoiceLink(TENANT, INVOICE, exp);
    expect(verifyInvoiceLink(TENANT, INVOICE, exp, sig, exp - 10)).toBe(true);
    expect(verifyInvoiceLink(TENANT, INVOICE, exp, sig, exp + 1)).toBe(false);
  });

  it('no sirve para otra clínica, otra factura ni con la caducidad cambiada', () => {
    const exp = 2_000_000_000;
    const sig = signInvoiceLink(TENANT, INVOICE, exp);
    const now = exp - 10;
    expect(verifyInvoiceLink('22222222-2222-2222-2222-222222222222', INVOICE, exp, sig, now)).toBe(
      false,
    );
    expect(verifyInvoiceLink(TENANT, '00000000-0000-0000-0000-000000000000', exp, sig, now)).toBe(
      false,
    );
    expect(verifyInvoiceLink(TENANT, INVOICE, exp + 3600, sig, now)).toBe(false);
    expect(verifyInvoiceLink(TENANT, INVOICE, exp, null, now)).toBe(false);
    expect(verifyInvoiceLink(TENANT, INVOICE, exp, `${sig}x`, now)).toBe(false);
  });

  it('arma la ruta pública con exp y sig', () => {
    const path = invoicePublicPath(TENANT, INVOICE, 3600);
    const url = new URL(`https://app.test${path}`);
    expect(url.pathname).toBe(`/api/public/facturas/${INVOICE}`);
    const exp = Number(url.searchParams.get('exp'));
    expect(verifyInvoiceLink(TENANT, INVOICE, exp, url.searchParams.get('sig'))).toBe(true);
  });
});

function props(over: Partial<InvoiceDialogProps> = {}): InvoiceDialogProps {
  return {
    patientKey: 'pat:1',
    patientId: '33333333-3333-3333-3333-333333333333',
    patientName: 'Elena De Gorgolas',
    clinicName: 'Respinens',
    issuerName: 'Raquel Pinto Egea',
    vatRate: 0,
    // Objetos nuevos en cada llamada: es lo que pasa cuando la ficha se refresca.
    defaults: {
      name: 'Mama Lorena',
      taxId: null,
      address: null,
      email: null,
      phone: '+34699308814',
    },
    candidates: [
      {
        appointmentId: '44444444-4444-4444-4444-444444444444',
        when: 'mar, 29 sept 2026',
        concept: 'Sesión de fisioterapia respiratoria pediátrica',
        unitCents: 4000,
        chargeStatus: 'PAID',
        paymentMethod: 'CASH',
        invoice: null,
      },
    ],
    todayKey: '2026-09-30',
    open: true,
    onOpenChange: vi.fn(),
    ...over,
  };
}

describe('modal de factura', () => {
  it('tras emitir sigue enseñando la factura aunque la ficha se refresque', async () => {
    issueInvoiceAction.mockResolvedValue({
      ok: true,
      data: { id: INVOICE, number: '2026-0000001', totalCents: 4000 },
    });
    const { rerender } = render(<InvoiceDialog {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: /Emitir factura/ }));
    await waitFor(() => expect(screen.getByText(/Factura 2026-0000001 emitida/)).toBeTruthy());

    // La ficha se refresca: llegan `defaults` y `candidates` nuevos, con la
    // sesión ya facturada.
    rerender(
      <InvoiceDialog
        {...props({
          candidates: [
            { ...props().candidates[0]!, invoice: { id: INVOICE, number: '2026-0000001' } },
          ],
        })}
      />,
    );
    expect(screen.getByText(/Factura 2026-0000001 emitida/)).toBeTruthy();
    const download = screen.getByRole('link', { name: /Descargar PDF/ });
    expect(download.getAttribute('href')).toBe(`/api/facturas/${INVOICE}/pdf?download=1`);
    expect(screen.getByRole('link', { name: /Ver factura/ }).getAttribute('href')).toBe(
      `/api/facturas/${INVOICE}/pdf`,
    );
  });

  it('al volver a abrirlo parte limpio', async () => {
    issueInvoiceAction.mockResolvedValue({
      ok: true,
      data: { id: INVOICE, number: '2026-0000001', totalCents: 4000 },
    });
    const { rerender } = render(<InvoiceDialog {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: /Emitir factura/ }));
    await waitFor(() => expect(screen.getByText(/Factura 2026-0000001 emitida/)).toBeTruthy());
    rerender(<InvoiceDialog {...props({ open: false })} />);
    rerender(<InvoiceDialog {...props({ open: true })} />);
    expect(screen.getByText('Nueva factura')).toBeTruthy();
  });
});
