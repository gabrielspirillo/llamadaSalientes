// El consentimiento como PDF, ya relleno, listo para que el tutor lo firme.
//
// Se tipografía aquí con pdf-lib (puro, sin navegador) y no con una plantilla
// de Documenso por una razón: así el PDF sale con el nombre del niño, su fecha
// de nacimiento y los datos del tutor ya puestos, y el tutor sólo tiene que
// leer y firmar desde el móvil. Y como el diseño es nuestro, sabemos EXACTAMENTE
// dónde va la firma y dónde la fecha, que es lo que hay que decirle a Documenso
// (en porcentaje de la página, origen arriba a la izquierda).
//
// Sin `server-only` a propósito: se testea sin base.

import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from 'pdf-lib';

import type { ConsentBody, ConsentParties } from '@/lib/consents/template';

export interface PdfFieldSpec {
  type: 'SIGNATURE' | 'DATE';
  /** 1-based. */
  pageNumber: number;
  /** Porcentajes de la página, origen arriba a la izquierda (como Documenso). */
  pageX: number;
  pageY: number;
  pageWidth: number;
  pageHeight: number;
}

export interface RenderedConsent {
  bytes: Uint8Array;
  fields: PdfFieldSpec[];
  pages: number;
}

// A4 en puntos.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 26;

const SIZE_TITLE = 15;
const SIZE_HEADING = 11.5;
const SIZE_BODY = 9.6;
const SIZE_SMALL = 8;
const LINE = 1.38;

const INK = rgb(0.13, 0.13, 0.15);
const MUTED = rgb(0.4, 0.4, 0.45);
const RULE = rgb(0.78, 0.78, 0.82);

/**
 * Helvetica sólo sabe WinAnsi: castellano completo, comillas, guiones largos y
 * el punto medio, pero ni emojis ni flechas. Lo que no cabe se quita antes de
 * dibujar, en vez de reventar a mitad de página.
 */
function sanitize(text: string): string {
  return text
    .replace(/ /g, ' ')
    .replace(/[‐-‒]/g, '-')
    .replace(/[^\u0009\u000a -~¡-ÿ–—‘’“”•…€™]/g, '');
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of sanitize(text).split('\n')) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

class Writer {
  readonly doc: PDFDocument;
  page: PDFPage;
  y: number;
  readonly fields: PdfFieldSpec[] = [];

  constructor(
    doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.doc = doc;
    this.page = doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }

  get pageNumber(): number {
    return this.doc.getPageCount();
  }

  /** Salta de página si lo que viene no cabe encima del pie. */
  ensure(height: number): void {
    if (this.y - height < MARGIN + FOOTER_H) {
      this.page = this.doc.addPage([PAGE_W, PAGE_H]);
      this.y = PAGE_H - MARGIN;
    }
  }

  gap(points: number): void {
    this.y -= points;
  }

  text(
    text: string,
    opts: { size?: number; font?: PDFFont; indent?: number; color?: ReturnType<typeof rgb> } = {},
  ): void {
    const size = opts.size ?? SIZE_BODY;
    const font = opts.font ?? this.regular;
    const indent = opts.indent ?? 0;
    const lineH = size * LINE;
    for (const line of wrap(text, font, size, CONTENT_W - indent)) {
      this.ensure(lineH);
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.y - size,
        size,
        font,
        color: opts.color ?? INK,
      });
      this.y -= lineH;
    }
  }

  bullet(text: string, opts: { size?: number } = {}): void {
    const size = opts.size ?? SIZE_BODY;
    const indent = 14;
    const lineH = size * LINE;
    const lines = wrap(text, this.regular, size, CONTENT_W - indent);
    lines.forEach((line, i) => {
      this.ensure(lineH);
      if (i === 0) {
        this.page.drawText('•', { x: MARGIN + 3, y: this.y - size, size, font: this.regular, color: INK });
      }
      this.page.drawText(line, { x: MARGIN + indent, y: this.y - size, size, font: this.regular, color: INK });
      this.y -= lineH;
    });
  }

  /** "Etiqueta: valor", con la etiqueta en negrita y el valor a continuación. */
  labeled(label: string, value: string | null): void {
    const size = SIZE_BODY;
    const lineH = size * LINE;
    const labelText = sanitize(`${label}: `);
    const labelW = this.bold.widthOfTextAtSize(labelText, size);
    const lines = wrap(value?.trim() || '—', this.regular, size, CONTENT_W - labelW);
    lines.forEach((line, i) => {
      this.ensure(lineH);
      if (i === 0) {
        this.page.drawText(labelText, { x: MARGIN, y: this.y - size, size, font: this.bold, color: INK });
      }
      this.page.drawText(line, {
        x: MARGIN + (i === 0 ? labelW : 0),
        y: this.y - size,
        size,
        font: this.regular,
        color: INK,
      });
      this.y -= lineH;
    });
  }

  rule(): void {
    this.ensure(8);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y - 3 },
      end: { x: PAGE_W - MARGIN, y: this.y - 3 },
      thickness: 0.6,
      color: RULE,
    });
    this.y -= 10;
  }

  /** Registra un campo de Documenso sobre un rectángulo (coordenadas de pdf-lib, origen abajo). */
  field(type: PdfFieldSpec['type'], x: number, yTop: number, w: number, h: number): void {
    this.fields.push({
      type,
      pageNumber: this.pageNumber,
      pageX: (x / PAGE_W) * 100,
      pageY: ((PAGE_H - yTop) / PAGE_H) * 100,
      pageWidth: (w / PAGE_W) * 100,
      pageHeight: (h / PAGE_H) * 100,
    });
  }
}

export interface RenderConsentInput {
  title: string;
  body: ConsentBody;
  acknowledgments: string[];
  parties: ConsentParties;
}

export async function renderConsentPdf(input: RenderConsentInput): Promise<RenderedConsent> {
  const doc = await PDFDocument.create();
  doc.setTitle(sanitize(input.title));
  doc.setProducer('Futura');
  doc.setCreator('Futura');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, regular, bold);
  const { parties } = input;

  // Cabecera.
  w.text(parties.clinicName.toUpperCase(), { size: SIZE_SMALL, font: bold, color: MUTED });
  w.gap(2);
  w.text(input.title, { size: SIZE_TITLE, font: bold });
  w.gap(4);
  w.rule();

  // Cuerpo, tal como lo escribió la clínica.
  for (const block of input.body) {
    switch (block.type) {
      case 'heading':
        w.gap(6);
        w.text(block.text, { size: SIZE_HEADING, font: bold });
        w.gap(2);
        break;
      case 'paragraph':
        w.text(block.text);
        w.gap(5);
        break;
      case 'bullets':
        for (const item of block.items) w.bullet(item);
        w.gap(5);
        break;
      case 'numbered':
        block.items.forEach((item, i) => {
          w.text(`${i + 1}. ${item.title}`, { font: bold });
          if (item.text) w.text(item.text, { indent: 12 });
          w.gap(3);
        });
        w.gap(2);
        break;
    }
  }

  // Datos rellenos. Van juntos en la misma página que la firma cuando cabe.
  w.gap(6);
  w.rule();
  w.text('Datos del/la menor (paciente)', { size: SIZE_HEADING, font: bold });
  w.gap(2);
  w.labeled('Nombre y apellidos', parties.childName);
  w.labeled('Fecha de nacimiento', parties.childBirthDate);
  w.gap(6);
  w.text('Datos del padre, madre y/o tutor legal', { size: SIZE_HEADING, font: bold });
  w.gap(2);
  w.labeled('Nombre y apellidos', parties.guardianName);
  w.labeled('DNI/NIE', parties.guardianDni);
  w.labeled('Dirección', parties.guardianAddress);
  w.labeled('Teléfono 1', parties.guardianPhone);
  w.labeled('Teléfono 2', parties.guardianPhone2);
  w.labeled('Email', parties.guardianEmail);
  w.labeled('Fecha', parties.issuedOn);

  // Lo que se declara al firmar.
  if (input.acknowledgments.length > 0) {
    w.gap(8);
    w.text('Al firmar este documento declaro que:', { font: bold });
    w.gap(2);
    for (const item of input.acknowledgments) w.bullet(item);
  }

  // Firma y fecha: un bloque que no se parte entre páginas.
  const SIG_H = 74;
  const SIG_W = 250;
  const DATE_W = 150;
  const DATE_H = 26;
  const blockH = 14 + SIG_H + 8;
  w.gap(12);
  w.ensure(blockH);
  w.text('Firma del padre, madre o tutor legal', { font: bold });
  w.gap(4);
  const sigTop = w.y;
  w.page.drawRectangle({
    x: MARGIN,
    y: sigTop - SIG_H,
    width: SIG_W,
    height: SIG_H,
    borderColor: RULE,
    borderWidth: 0.8,
  });
  w.field('SIGNATURE', MARGIN, sigTop, SIG_W, SIG_H);

  const dateX = MARGIN + SIG_W + 24;
  w.page.drawText('Fecha de la firma', {
    x: dateX,
    y: sigTop - SIZE_SMALL,
    size: SIZE_SMALL,
    font: bold,
    color: MUTED,
  });
  const dateTop = sigTop - SIZE_SMALL - 6;
  w.page.drawRectangle({
    x: dateX,
    y: dateTop - DATE_H,
    width: DATE_W,
    height: DATE_H,
    borderColor: RULE,
    borderWidth: 0.8,
  });
  w.field('DATE', dateX, dateTop, DATE_W, DATE_H);
  w.y = sigTop - SIG_H - 8;

  // Pie en todas las páginas, ahora que se sabe cuántas hay.
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const footer = sanitize(
      `${input.title} · ${parties.clinicName} · Página ${i + 1} de ${pages.length}`,
    );
    page.drawText(footer, {
      x: MARGIN,
      y: MARGIN - 10,
      size: SIZE_SMALL - 0.5,
      font: regular,
      color: MUTED,
    });
  });

  const bytes = await doc.save();
  return { bytes, fields: w.fields, pages: pages.length };
}
