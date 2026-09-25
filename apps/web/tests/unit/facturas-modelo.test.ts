import { describe, expect, it } from 'vitest';

import {
  buildInvoiceMailto,
  buildInvoiceMessage,
  computeTotals,
  formatDateEs,
  formatInvoiceNumber,
  groupSessionsIntoItems,
  invoiceFileName,
  normalizeTaxId,
} from '@/lib/invoices/model';
import { renderInvoicePdf } from '@/lib/invoices/pdf';

/**
 * Facturas desde la ficha: la numeración, cómo se agrupan las sesiones, las
 * sumas y que el PDF con el diseño de Respinens se genere de una pieza.
 */

describe('modelo de factura', () => {
  it('numera por año a siete cifras', () => {
    expect(formatInvoiceNumber(2026, 32)).toBe('2026-0000032');
    expect(formatInvoiceNumber(2027, 1)).toBe('2027-0000001');
  });

  it('agrupa sesiones iguales en una línea con cantidad y separa las sin precio', () => {
    const items = groupSessionsIntoItems([
      { appointmentId: 'a', concept: 'Sesión de fisioterapia', unitCents: 4000 },
      { appointmentId: 'b', concept: 'Sesión de fisioterapia', unitCents: 4000 },
      { appointmentId: 'c', concept: 'Primera visita', unitCents: 5500 },
      { appointmentId: 'd', concept: 'Sesión de fisioterapia', unitCents: null },
    ]);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      concept: 'Sesión de fisioterapia',
      quantity: 2,
      unitCents: 4000,
      appointmentIds: ['a', 'b'],
    });
    expect(items[2]).toMatchObject({ quantity: 1, unitCents: 0, appointmentIds: ['d'] });
  });

  it('suma base, IVA y total', () => {
    const items = [
      { concept: 'x', quantity: 3, unitCents: 4000, appointmentIds: [] },
      { concept: 'y', quantity: 1, unitCents: 1250, appointmentIds: [] },
    ];
    expect(computeTotals(items, 0)).toEqual({
      subtotalCents: 13250,
      vatCents: 0,
      totalCents: 13250,
    });
    expect(computeTotals(items, 21)).toEqual({
      subtotalCents: 13250,
      vatCents: 2783,
      totalCents: 16033,
    });
  });

  it('formatea fecha, nombre de archivo y NIF', () => {
    expect(formatDateEs('2026-04-16')).toBe('16/04/2026');
    expect(invoiceFileName('2026-0000032')).toBe('Factura-2026-0000032.pdf');
    expect(normalizeTaxId(' 70055622-z ')).toBe('70055622Z');
    expect(normalizeTaxId('')).toBeNull();
  });

  it('escribe el WhatsApp y el correo con el nombre de pila', () => {
    const msg = buildInvoiceMessage({
      tutorName: 'Diana Mangas Pozo',
      clinicName: 'Respinens',
      number: '2026-0000032',
      totalCents: 4000,
      patientName: 'Marc García Mangas',
    });
    expect(msg).toContain('Hola Diana');
    expect(msg).toContain('2026-0000032');
    expect(msg).toContain('Marc');
    const mailto = buildInvoiceMailto({
      to: 'diana@example.com',
      clinicName: 'Respinens',
      number: '2026-0000032',
      tutorName: 'Diana Mangas',
      patientName: 'Marc',
      totalCents: 4000,
    });
    expect(mailto.startsWith('mailto:diana%40example.com?subject=')).toBe(true);
    expect(decodeURIComponent(mailto)).toContain('Factura 2026-0000032');
  });
});

describe('renderInvoicePdf', () => {
  const issuer = {
    name: 'Raquel Pinto Egea',
    subtitle: 'Fisioterapeuta · Colegiada nº 10.751',
    taxId: '05442362X',
    addressLines: ['Av. de Carmen Martín Gaite, 17', '28919 Leganés, Madrid'],
    email: 'respinens@gmail.com',
    phone: '676 790 181',
    iban: 'ES00 0000 0000 0000 0000 0000',
    logoUrl: null,
    tagline: 'Fisioterapia respiratoria pediátrica',
    footerLeft: 'Respinens · Fisioterapia respiratoria pediátrica',
    footerCenter: 'Centro autorizado CS17385',
    footerRight: 'www.respinens.es',
    vatRate: 0,
    vatNote: 'Operación exenta por el art. 20 de la Ley 37/1992 del IVA',
  };

  it('genera un PDF de una página con y sin IBAN', async () => {
    const items = [
      {
        concept: 'Sesión de fisioterapia respiratoria pediátrica',
        quantity: 3,
        unitCents: 4000,
        appointmentIds: [],
      },
    ];
    const bytes = await renderInvoicePdf({
      number: '2026-0000032',
      issuedOn: '16/04/2026',
      issuer,
      billTo: {
        name: 'Diana Mangas Pozo',
        taxId: '70055622Z',
        address: null,
        email: null,
        phone: null,
      },
      patientName: 'Marc García Mangas',
      items,
      totals: computeTotals(items, 0),
      vatRate: 0,
      paymentMethodLabel: 'Transferencia bancaria',
      showIban: true,
      notes: null,
    });
    expect(bytes.byteLength).toBeGreaterThan(1500);
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 8));
    expect(head.startsWith('%PDF-')).toBe(true);
    // Sin logo, sin IBAN, anulada y con un concepto largo que salta de línea.
    const bytes2 = await renderInvoicePdf({
      number: '2026-0000033',
      issuedOn: '17/04/2026',
      issuer: { ...issuer, iban: null },
      billTo: {
        name: 'Diana Mangas Pozo',
        taxId: null,
        address: 'Calle Mayor 1, Leganés',
        email: 'd@example.com',
        phone: '+34600111222',
      },
      patientName: 'Marc García Mangas',
      items: [
        {
          concept:
            'Sesión de fisioterapia respiratoria pediátrica con valoración inicial y plan de tratamiento domiciliario',
          quantity: 1,
          unitCents: 5500,
          appointmentIds: [],
        },
        { concept: 'Bono de 5 sesiones', quantity: 1, unitCents: 18000, appointmentIds: [] },
      ],
      totals: computeTotals(
        [{ concept: 'a', quantity: 1, unitCents: 23500, appointmentIds: [] }],
        21,
      ),
      vatRate: 21,
      paymentMethodLabel: 'Efectivo',
      showIban: false,
      notes: 'Pagado en consulta.',
      voided: true,
    });
    expect(bytes2.byteLength).toBeGreaterThan(1500);
  });
});
