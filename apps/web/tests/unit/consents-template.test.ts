import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONSENT_MESSAGE,
  formatDateKeyEs,
  parseAcknowledgments,
  parseConsentBody,
  renderConsentMessage,
} from '@/lib/consents/template';

describe('el mensaje de WhatsApp del consentimiento', () => {
  const vars = {
    tutor: 'Laura',
    paciente: 'Martina',
    clinica: 'Respinens',
    enlace: 'https://consentimiento.respinens.es/sign/abc',
  };

  it('rellena los marcadores y lleva el enlace', () => {
    const text = renderConsentMessage(null, vars);
    expect(text).toContain('Hola Laura');
    expect(text).toContain('Respinens');
    expect(text).toContain('Martina');
    expect(text).toContain(vars.enlace);
    expect(text).toBe(renderConsentMessage(DEFAULT_CONSENT_MESSAGE, vars));
  });

  it('una plantilla propia sin {{enlace}} igual lo lleva al final', () => {
    const text = renderConsentMessage('Firma el consentimiento de {{paciente}}, por favor.', vars);
    expect(text.startsWith('Firma el consentimiento de Martina, por favor.')).toBe(true);
    expect(text.endsWith(vars.enlace)).toBe(true);
  });

  it('un marcador desconocido se deja a la vista, no desaparece', () => {
    expect(renderConsentMessage('Hola {{tutora}} {{enlace}}', vars)).toContain('{{tutora}}');
  });
});

describe('la plantilla del consentimiento', () => {
  it('acepta los cuatro tipos de bloque y rechaza lo demás', () => {
    expect(
      parseConsentBody([
        { type: 'heading', text: 'Protección de datos' },
        { type: 'paragraph', text: 'Texto' },
        { type: 'bullets', items: ['a', 'b'] },
        { type: 'numbered', items: [{ title: 'Responsable', text: 'Respinens' }] },
      ]),
    ).toHaveLength(4);
    expect(parseConsentBody([{ type: 'table', rows: [] }])).toBeNull();
    expect(parseConsentBody([])).toBeNull();
    expect(parseConsentBody('no')).toBeNull();
  });

  it('las declaraciones son una lista de frases', () => {
    expect(parseAcknowledgments(['Autorizo…'])).toEqual(['Autorizo…']);
    expect(parseAcknowledgments(null)).toEqual([]);
    expect(parseAcknowledgments([''])).toEqual([]);
  });

  it('la fecha se imprime como en España', () => {
    expect(formatDateKeyEs('2026-09-22')).toBe('22/09/2026');
    expect(formatDateKeyEs('22/09/2026')).toBeNull();
    expect(formatDateKeyEs(null)).toBeNull();
  });
});
