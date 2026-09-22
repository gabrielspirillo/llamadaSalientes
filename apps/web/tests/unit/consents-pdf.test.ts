import { describe, expect, it } from 'vitest';

import { renderConsentPdf } from '@/lib/consents/pdf';
import type { ConsentBody } from '@/lib/consents/template';

/**
 * El PDF del consentimiento: que se genere, que quepa lo largo y que la firma
 * y la fecha queden dentro de la página, en porcentajes, como los quiere
 * Documenso.
 */

const parties = {
  clinicName: 'Respinens',
  childName: 'Martina Ruiz Gómez',
  childBirthDate: '15/01/2025',
  guardianName: 'Laura Gómez Pérez',
  guardianDni: '12345678A',
  guardianAddress: 'Calle Mayor 1, Leganés',
  guardianPhone: '+34600111222',
  guardianPhone2: null,
  guardianEmail: null,
  issuedOn: '22/09/2026',
};

function longBody(paragraphs: number): ConsentBody {
  const text =
    'La fisioterapia respiratoria es una especialidad de la fisioterapia que desarrolla un conjunto de procedimientos con el objetivo de la prevención, curación y estabilización de alteraciones que afectan al sistema respiratorio. ';
  return [
    { type: 'heading', text: 'Consentimiento' },
    ...Array.from({ length: paragraphs }, () => ({
      type: 'paragraph' as const,
      text: text.repeat(3),
    })),
    { type: 'bullets', items: ['Frecuentes: vómitos', 'Raras: fiebre, petequias'] },
    { type: 'numbered', items: [{ title: 'Responsable', text: 'RESPINENS, Leganés.' }] },
  ];
}

describe('renderConsentPdf', () => {
  it('genera un PDF con la firma y la fecha dentro de la página', async () => {
    const out = await renderConsentPdf({
      title: 'Consentimiento informado para menores de edad',
      body: longBody(2),
      acknowledgments: ['Autorizo a RESPINENS.', 'Entiendo que puedo revocarlo.'],
      parties,
    });
    expect(Buffer.from(out.bytes.slice(0, 5)).toString()).toBe('%PDF-');
    expect(out.pages).toBeGreaterThanOrEqual(1);
    expect(out.fields.map((f) => f.type).sort()).toEqual(['DATE', 'SIGNATURE']);
    for (const f of out.fields) {
      expect(f.pageNumber).toBeGreaterThanOrEqual(1);
      expect(f.pageNumber).toBeLessThanOrEqual(out.pages);
      expect(f.pageX).toBeGreaterThan(0);
      expect(f.pageY).toBeGreaterThan(0);
      expect(f.pageX + f.pageWidth).toBeLessThan(100);
      expect(f.pageY + f.pageHeight).toBeLessThan(100);
    }
  });

  it('un texto largo salta de página y la firma queda en la última', async () => {
    const out = await renderConsentPdf({
      title: 'Consentimiento',
      body: longBody(14),
      acknowledgments: [],
      parties,
    });
    expect(out.pages).toBeGreaterThan(1);
    for (const f of out.fields) expect(f.pageNumber).toBe(out.pages);
  });

  it('los caracteres que Helvetica no tiene no revientan el PDF', async () => {
    const out = await renderConsentPdf({
      title: 'Consentimiento → firma 🙂',
      body: [{ type: 'paragraph', text: 'Niño ñ, "comillas", 5 €, — raya, … puntos, ❤ y 中文.' }],
      acknowledgments: [],
      parties: { ...parties, guardianName: 'Zoë Müller' },
    });
    expect(out.pages).toBe(1);
  });
});
