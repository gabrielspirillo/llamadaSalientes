// La factura como PDF, con el diseño de la plantilla de Respinens: logo
// centrado, banda con documento / nº / fecha / total, emisor a la izquierda y
// "Facturar a · Tutor/a legal" + paciente a la derecha, tabla de conceptos,
// base + IVA + total, forma de pago y observaciones, y el pie verde.
//
// Se dibuja con pdf-lib (sin navegador) igual que el consentimiento: el
// diseño es nuestro y así el PDF sale idéntico en el servidor. Sin
// `server-only`: se testea sin base. El logo llega en bytes (quien llama lo
// baja con timeout); sin logo, el nombre del emisor hace de cabecera.

import {
  PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  StandardFonts,
  rgb,
} from 'pdf-lib';

import {
  type InvoiceBillTo,
  type InvoiceIssuer,
  type InvoiceItem,
  formatCents,
} from '@/lib/invoices/model';

// A4 en puntos. La plantilla está pensada a 860 px de ancho: todo se escala.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const S = PAGE_W / 860;
const MX = 60 * S;
const CONTENT_W = PAGE_W - MX * 2;

const GREEN = rgb(0.18, 0.459, 0.388); // #2e7563
const GREEN_LIGHT = rgb(0.933, 0.965, 0.945); // #eef6f1
const GREEN_LINE = rgb(0.827, 0.898, 0.855); // #d3e5da
const ACCENT = rgb(0.369, 0.663, 0.541); // #5ea98a
const BORDER = rgb(0.867, 0.902, 0.882); // #dde6e1
const INK = rgb(0.196, 0.208, 0.208); // #323535
const MUTED = rgb(0.302, 0.333, 0.325); // #4d5553
const MUTED_2 = rgb(0.424, 0.459, 0.447); // #6c7572
const WHITE = rgb(1, 1, 1);

/** Helvetica sólo sabe WinAnsi: lo que no cabe (emojis, flechas) se quita. */
function sanitize(text: string): string {
  return text
    .replace(/ /g, ' ')
    .replace(/\t/g, ' ')
    .replace(/[‐-‒]/g, '-')
    .replace(/[^ -~¡-ÿ–—‘’“”•…€™]/g, '');
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    const words = sanitize(rawLine).split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
      else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/** Rectángulo con esquinas redondeadas (pdf-lib no lo trae): un path SVG. */
function roundedRectPath(
  w: number,
  h: number,
  r: number,
  corners = { tl: true, tr: true, br: true, bl: true },
): string {
  const rr = Math.min(r, w / 2, h / 2);
  const tl = corners.tl ? rr : 0;
  const tr = corners.tr ? rr : 0;
  const br = corners.br ? rr : 0;
  const bl = corners.bl ? rr : 0;
  return [
    `M ${tl} 0`,
    `H ${w - tr}`,
    tr ? `A ${tr} ${tr} 0 0 1 ${w} ${tr}` : '',
    `V ${h - br}`,
    br ? `A ${br} ${br} 0 0 1 ${w - br} ${h}` : '',
    `H ${bl}`,
    bl ? `A ${bl} ${bl} 0 0 1 0 ${h - bl}` : '',
    `V ${tl}`,
    tl ? `A ${tl} ${tl} 0 0 1 ${tl} 0` : '',
    'Z',
  ]
    .filter(Boolean)
    .join(' ');
}

type Corners = { tl: boolean; tr: boolean; br: boolean; bl: boolean };

class Canvas {
  constructor(
    readonly page: PDFPage,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
  ) {}

  /** `yTop` en coordenadas "desde arriba", que es como está pensada la plantilla. */
  rounded(
    x: number,
    yTop: number,
    w: number,
    h: number,
    r: number,
    opts: {
      fill?: ReturnType<typeof rgb>;
      stroke?: ReturnType<typeof rgb>;
      corners?: Corners;
    } = {},
  ): void {
    const path = roundedRectPath(w, h, r, opts.corners);
    // drawSvgPath toma el origen arriba a la izquierda del path y dibuja hacia abajo.
    this.page.drawSvgPath(path, {
      x,
      y: PAGE_H - yTop,
      color: opts.fill,
      borderColor: opts.stroke,
      borderWidth: opts.stroke ? 0.8 : 0,
    });
  }

  rect(x: number, yTop: number, w: number, h: number, fill: ReturnType<typeof rgb>): void {
    this.page.drawRectangle({ x, y: PAGE_H - yTop - h, width: w, height: h, color: fill });
  }

  hline(
    x: number,
    yTop: number,
    w: number,
    thickness: number,
    color: ReturnType<typeof rgb>,
  ): void {
    this.page.drawLine({
      start: { x, y: PAGE_H - yTop },
      end: { x: x + w, y: PAGE_H - yTop },
      thickness,
      color,
    });
  }

  vline(x: number, yTop: number, h: number, color: ReturnType<typeof rgb>): void {
    this.page.drawLine({
      start: { x, y: PAGE_H - yTop },
      end: { x, y: PAGE_H - yTop - h },
      thickness: 0.8,
      color,
    });
  }

  width(text: string, size: number, font: PDFFont, spacing = 0): number {
    const t = sanitize(text);
    return font.widthOfTextAtSize(t, size) + spacing * Math.max(0, t.length - 1);
  }

  /**
   * Texto con `yTop` = borde superior de la caja de la línea. `spacing` es el
   * espaciado entre letras (las etiquetas en mayúsculas de la plantilla);
   * pdf-lib no lo trae, así que se dibuja letra a letra.
   */
  text(
    text: string,
    x: number,
    yTop: number,
    opts: {
      size: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      align?: 'left' | 'right' | 'center';
      width?: number;
      spacing?: number;
    },
  ): void {
    const font = opts.font ?? this.regular;
    const t = sanitize(text);
    const w = this.width(t, opts.size, font, opts.spacing ?? 0);
    let startX = x;
    if (opts.align === 'right') startX = x + (opts.width ?? 0) - w;
    else if (opts.align === 'center') startX = x + ((opts.width ?? 0) - w) / 2;
    const y = PAGE_H - yTop - opts.size;
    if (!opts.spacing) {
      this.page.drawText(t, { x: startX, y, size: opts.size, font, color: opts.color ?? INK });
      return;
    }
    let cx = startX;
    for (const ch of t) {
      this.page.drawText(ch, { x: cx, y, size: opts.size, font, color: opts.color ?? INK });
      cx += font.widthOfTextAtSize(ch, opts.size) + opts.spacing;
    }
  }

  /** Párrafo con salto de línea; devuelve la altura ocupada. */
  paragraph(
    text: string,
    x: number,
    yTop: number,
    opts: {
      size: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      width: number;
      lineHeight?: number;
    },
  ): number {
    const font = opts.font ?? this.regular;
    const lh = opts.size * (opts.lineHeight ?? 1.6);
    let y = yTop;
    for (const line of wrap(text, font, opts.size, opts.width)) {
      this.page.drawText(line, {
        x,
        y: PAGE_H - y - opts.size,
        size: opts.size,
        font,
        color: opts.color ?? INK,
      });
      y += lh;
    }
    return y - yTop;
  }
}

/** Etiqueta de sección: verde, mayúsculas, espaciada y con la línea de acento debajo. */
function sectionLabel(c: Canvas, label: string, x: number, yTop: number, width: number): number {
  const size = 11 * S;
  c.text(label.toUpperCase(), x, yTop, { size, font: c.bold, color: GREEN, spacing: 1.2 });
  const lineY = yTop + size + 8 * S;
  c.hline(x, lineY, width, 1.2, ACCENT);
  return lineY + 6 * S;
}

export interface RenderInvoiceInput {
  number: string;
  /** 'DD/MM/YYYY' */
  issuedOn: string;
  issuer: InvoiceIssuer;
  billTo: InvoiceBillTo;
  patientName: string;
  items: InvoiceItem[];
  totals: { subtotalCents: number; vatCents: number; totalCents: number };
  vatRate: number;
  paymentMethodLabel: string | null;
  /** El IBAN sólo se imprime con transferencia. */
  showIban: boolean;
  notes: string | null;
  /** Anulada: se marca en grande. */
  voided?: boolean;
  logo?: { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' } | null;
}

export async function renderInvoicePdf(input: RenderInvoiceInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(sanitize(`Factura ${input.number}`));
  doc.setProducer('Futura');
  doc.setCreator('Futura');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const c = new Canvas(page, regular, bold);
  const { issuer } = input;

  let y = 48 * S;

  // ── Logo o nombre, centrado, y el lema ────────────────────────────────
  let logo: PDFImage | null = null;
  if (input.logo) {
    try {
      logo =
        input.logo.mime === 'image/png'
          ? await doc.embedPng(input.logo.bytes)
          : await doc.embedJpg(input.logo.bytes);
    } catch {
      logo = null;
    }
  }
  if (logo) {
    const w = 300 * S;
    const h = (logo.height / logo.width) * w;
    page.drawImage(logo, { x: (PAGE_W - w) / 2, y: PAGE_H - y - h, width: w, height: h });
    y += h;
  } else {
    const size = 26 * S;
    c.text(issuer.name, MX, y, {
      size,
      font: bold,
      color: GREEN,
      align: 'center',
      width: CONTENT_W,
    });
    y += size;
  }
  if (issuer.tagline) {
    y += 14 * S;
    const size = 11.5 * S;
    c.text(issuer.tagline.toUpperCase(), MX, y, {
      size,
      font: bold,
      color: GREEN,
      align: 'center',
      width: CONTENT_W,
      spacing: 2,
    });
    y += size;
  }

  // ── Banda: documento · nº · fecha · total ─────────────────────────────
  y += 63 * S;
  const bandH = 64 * S;
  const unit = CONTENT_W / 4.2;
  const cols: [number, number, number, number] = [unit, unit, unit, unit * 1.2];
  const totalCellX = MX + cols[0] + cols[1] + cols[2];
  c.rounded(MX, y, CONTENT_W, bandH, 10 * S, { fill: GREEN_LIGHT });
  c.rounded(totalCellX, y, cols[3], bandH, 10 * S, {
    fill: GREEN,
    corners: { tl: false, bl: false, tr: true, br: true },
  });
  const labelSize = 10.5 * S;
  const valueSize = 15 * S;
  const cells: { label: string; value: string; size?: number }[] = [
    { label: 'Documento', value: input.voided ? 'FACTURA ANULADA' : 'FACTURA', size: 17 * S },
    { label: 'Nº factura', value: input.number },
    { label: 'Fecha', value: input.issuedOn },
  ];
  let cx = MX;
  cells.forEach((cell, i) => {
    if (i > 0) c.vline(cx, y, bandH, GREEN_LINE);
    c.text(cell.label.toUpperCase(), cx + 18 * S, y + 16 * S, {
      size: labelSize,
      font: bold,
      color: GREEN,
      spacing: 1.2,
    });
    c.text(cell.value, cx + 18 * S, y + 16 * S + labelSize + 6 * S, {
      size: cell.size ?? valueSize,
      font: bold,
      color: INK,
      spacing: cell.size ? 1 : 0,
    });
    cx += cols[i] ?? 0;
  });
  const totalCellW = cols[3] - 35 * S;
  c.text('TOTAL', totalCellX + 18 * S, y + 16 * S, {
    size: labelSize,
    font: bold,
    color: WHITE,
    align: 'right',
    width: totalCellW,
    spacing: 1.2,
  });
  c.text(
    formatCents(input.totals.totalCents),
    totalCellX + 18 * S,
    y + 16 * S + labelSize + 6 * S,
    { size: 20 * S, font: bold, color: WHITE, align: 'right', width: totalCellW },
  );
  y += bandH;

  // ── Emisor · Facturar a · Paciente ────────────────────────────────────
  y += 40 * S;
  const colW = (CONTENT_W - 24 * S) / 2;
  const rightX = MX + colW + 24 * S;
  const nameSize = 16 * S;
  const bodySize = 12.5 * S;

  let ly = sectionLabel(c, 'Emisor', MX, y, colW);
  c.text(issuer.name, MX, ly, { size: nameSize, font: bold });
  ly += nameSize + 6 * S;
  const issuerLines = [
    issuer.subtitle,
    issuer.taxId ? `NIF: ${issuer.taxId}` : null,
    ...issuer.addressLines,
    [issuer.email, issuer.phone].filter(Boolean).join(' · ') || null,
  ].filter((l): l is string => Boolean(l));
  ly += c.paragraph(issuerLines.join('\n'), MX, ly, { size: bodySize, color: MUTED, width: colW });

  let ry = sectionLabel(c, 'Facturar a · Tutor/a legal', rightX, y, colW);
  c.text(input.billTo.name, rightX, ry, { size: nameSize, font: bold });
  ry += nameSize + 6 * S;
  const billLines = [
    input.billTo.taxId ? `NIF: ${input.billTo.taxId}` : null,
    input.billTo.address,
    [input.billTo.email, input.billTo.phone].filter(Boolean).join(' · ') || null,
  ].filter((l): l is string => Boolean(l));
  if (billLines.length > 0) {
    ry += c.paragraph(billLines.join('\n'), rightX, ry, {
      size: bodySize,
      color: MUTED,
      width: colW,
    });
  }
  ry += 18 * S;
  ry = sectionLabel(c, 'Paciente', rightX, ry, colW);
  c.text(input.patientName, rightX, ry, { size: nameSize, font: bold });
  ry += nameSize;

  y = Math.max(ly, ry);

  // ── Tabla de conceptos ────────────────────────────────────────────────
  y += 40 * S;
  const tableTop = y;
  const gap = 12 * S;
  const pad = 16 * S;
  const cQty = 60 * S;
  const cPrice = 96 * S;
  const cAmount = 104 * S;
  const cConcept = CONTENT_W - pad * 2 - gap * 3 - cQty - cPrice - cAmount;
  const xConcept = MX + pad;
  const xQty = xConcept + cConcept + gap;
  const xPrice = xQty + cQty + gap;
  const xAmount = xPrice + cPrice + gap;
  const headH = 11 * S * 2 + labelSize;
  c.rounded(MX, y, CONTENT_W, headH, 10 * S, {
    fill: GREEN_LIGHT,
    corners: { tl: true, tr: true, br: false, bl: false },
  });
  const hy = y + 11 * S;
  c.text('CONCEPTO', xConcept, hy, { size: labelSize, font: bold, color: GREEN, spacing: 1 });
  c.text('CANT.', xQty, hy, {
    size: labelSize,
    font: bold,
    color: GREEN,
    align: 'center',
    width: cQty,
    spacing: 1,
  });
  c.text('PRECIO', xPrice, hy, {
    size: labelSize,
    font: bold,
    color: GREEN,
    align: 'right',
    width: cPrice,
    spacing: 1,
  });
  c.text('IMPORTE', xAmount, hy, {
    size: labelSize,
    font: bold,
    color: GREEN,
    align: 'right',
    width: cAmount,
    spacing: 1,
  });
  y += headH;

  const rowSize = 13.5 * S;
  y += pad;
  for (const item of input.items) {
    const lines = wrap(item.concept, bold, rowSize, cConcept);
    const rowH = Math.max(1, lines.length) * rowSize * 1.4;
    lines.forEach((line, i) => {
      c.text(line, xConcept, y + i * rowSize * 1.4, { size: rowSize, font: bold });
    });
    c.text(String(item.quantity), xQty, y, { size: rowSize, align: 'center', width: cQty });
    c.text(formatCents(item.unitCents), xPrice, y, {
      size: rowSize,
      align: 'right',
      width: cPrice,
    });
    c.text(formatCents(Math.round(item.unitCents * item.quantity)), xAmount, y, {
      size: rowSize,
      font: bold,
      align: 'right',
      width: cAmount,
    });
    y += rowH + 6 * S;
  }
  y += pad - 6 * S;

  // Totales, a la derecha.
  c.hline(MX, y, CONTENT_W, 0.8, BORDER);
  const totW = 300 * S;
  const totX = MX + CONTENT_W - totW + pad;
  const totInner = totW - pad * 2;
  y += 14 * S;
  const totSize = 12.5 * S;
  const totalsRows: [string, string][] = [
    ['Base imponible', formatCents(input.totals.subtotalCents)],
    [
      input.vatRate > 0 ? `IVA ${input.vatRate.toString().replace('.', ',')}%` : 'IVA 0% (exento)',
      formatCents(input.totals.vatCents),
    ],
  ];
  for (const [label, value] of totalsRows) {
    c.text(label, totX, y, { size: totSize, color: MUTED_2 });
    c.text(value, totX, y, { size: totSize, align: 'right', width: totInner });
    y += totSize + 8 * S;
  }
  c.hline(totX, y, totInner, 1.6, GREEN);
  y += 8 * S;
  c.text('TOTAL', totX, y + 6 * S, { size: 12 * S, font: bold, color: GREEN, spacing: 1.2 });
  c.text(formatCents(input.totals.totalCents), totX, y, {
    size: 22 * S,
    font: bold,
    align: 'right',
    width: totInner,
  });
  y += 22 * S + 14 * S;
  // Borde de la tabla entera.
  c.rounded(MX, tableTop, CONTENT_W, y - tableTop, 10 * S, { stroke: BORDER });

  // ── Forma de pago · Observaciones ─────────────────────────────────────
  y += 28 * S;
  const leftW = (CONTENT_W - 24 * S) / 3;
  const obsX = MX + leftW + 24 * S;
  const obsW = CONTENT_W - leftW - 24 * S;
  c.text('FORMA DE PAGO', MX, y, { size: labelSize, font: bold, color: GREEN, spacing: 1.2 });
  c.text('OBSERVACIONES', obsX, y, { size: labelSize, font: bold, color: GREEN, spacing: 1.2 });
  let py = y + labelSize + 6 * S;
  c.text(input.paymentMethodLabel ?? '—', MX, py, { size: 13.5 * S, font: bold });
  py += 13.5 * S + 6 * S;
  if (input.showIban && issuer.iban) {
    c.text(`IBAN: ${issuer.iban}`, MX, py, { size: 12 * S, color: MUTED });
    py += 12 * S + 4 * S;
  }
  let oy = y + labelSize + 6 * S;
  const obsText = [issuer.vatRate > 0 ? null : issuer.vatNote, input.notes]
    .filter(Boolean)
    .join('\n');
  if (obsText) {
    oy += c.paragraph(obsText, obsX, oy, {
      size: 12 * S,
      color: MUTED,
      width: obsW,
      lineHeight: 1.5,
    });
  }

  // ── Pie verde ─────────────────────────────────────────────────────────
  const footSize = 11.5 * S;
  const footH = footSize + 32 * S;
  const footTop = PAGE_H - footH;
  c.rect(0, footTop, PAGE_W, footH, GREEN);
  const fy = footTop + 16 * S;
  if (issuer.footerLeft)
    c.text(issuer.footerLeft, MX, fy, { size: footSize, font: bold, color: WHITE });
  if (issuer.footerCenter)
    c.text(issuer.footerCenter, MX, fy, {
      size: footSize,
      color: WHITE,
      align: 'center',
      width: CONTENT_W,
    });
  if (issuer.footerRight)
    c.text(issuer.footerRight, MX, fy, {
      size: footSize,
      color: WHITE,
      align: 'right',
      width: CONTENT_W,
    });

  // ── Anulada: marca diagonal ───────────────────────────────────────────
  if (input.voided) {
    page.drawText('ANULADA', {
      x: PAGE_W / 2 - 150,
      y: PAGE_H / 2 - 40,
      size: 72,
      font: bold,
      color: rgb(0.85, 0.2, 0.2),
      opacity: 0.18,
      rotate: { type: 'degrees', angle: 30 } as never,
    });
  }

  return doc.save();
}
