// Justificante de asistencia: un PDF de una página que la familia lleva al
// trabajo o al colegio. Lo pidió Respinens. Puro (sin base): quien llama trae
// los datos y, si lo hay, el logo de la clínica en bytes.
import { PDFDocument, type PDFFont, StandardFonts, rgb } from 'pdf-lib';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const INK = rgb(0.13, 0.13, 0.15);
const MUTED = rgb(0.4, 0.4, 0.45);
const RULE = rgb(0.78, 0.78, 0.82);

export interface AttendanceInput {
  clinic: { name: string; address: string | null; taxId: string | null; phone: string | null };
  professionalName: string;
  patientName: string;
  guardianName: string | null;
  /** "miércoles, 4 de noviembre de 2026" */
  dateLong: string;
  /** "16:30" */
  startTime: string;
  /** "17:00" */
  endTime: string;
  /** "4 de noviembre de 2026" */
  issuedOn: string;
  logo?: { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' } | null;
}

/** Helvetica sólo sabe WinAnsi: fuera emojis y rarezas. */
function sanitize(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–|—/g, '-')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '');
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = sanitize(text).split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const probe = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(probe, size) <= maxWidth) line = probe;
    else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderAttendancePdf(input: AttendanceInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(sanitize(`Justificante de asistencia - ${input.patientName}`));
  doc.setProducer('Futura');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const contentW = PAGE_W - MARGIN * 2;
  let y = PAGE_H - MARGIN;

  // Logo centrado o el nombre de la clínica.
  if (input.logo) {
    const img =
      input.logo.mime === 'image/png'
        ? await doc.embedPng(input.logo.bytes)
        : await doc.embedJpg(input.logo.bytes);
    const maxW = 170;
    const maxH = 64;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: (PAGE_W - w) / 2, y: y - h, width: w, height: h });
    y -= h + 14;
  } else {
    const t = sanitize(input.clinic.name.toUpperCase());
    page.drawText(t, {
      x: (PAGE_W - bold.widthOfTextAtSize(t, 16)) / 2,
      y: y - 16,
      size: 16,
      font: bold,
      color: INK,
    });
    y -= 30;
  }
  const sub = [
    input.clinic.address,
    input.clinic.taxId ? `NIF ${input.clinic.taxId}` : null,
    input.clinic.phone,
  ]
    .filter(Boolean)
    .map((s) => sanitize(String(s)))
    .join('  ·  ');
  if (sub) {
    page.drawText(sub, {
      x: (PAGE_W - regular.widthOfTextAtSize(sub, 9)) / 2,
      y: y - 9,
      size: 9,
      font: regular,
      color: MUTED,
    });
    y -= 20;
  }
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.8,
    color: RULE,
  });
  y -= 40;

  const title = 'JUSTIFICANTE DE ASISTENCIA';
  page.drawText(title, {
    x: (PAGE_W - bold.widthOfTextAtSize(title, 18)) / 2,
    y: y - 18,
    size: 18,
    font: bold,
    color: INK,
  });
  y -= 50;

  const paragraphs = [
    `${input.professionalName}, de ${input.clinic.name}, certifica que ${input.patientName}${
      input.guardianName ? `, acompañado/a por ${input.guardianName},` : ''
    } ha acudido a este centro el ${input.dateLong}, de ${input.startTime} a ${input.endTime} horas, para recibir tratamiento de fisioterapia.`,
    'Se expide el presente justificante a petición de la persona interesada y a los efectos oportunos.',
  ];
  for (const p of paragraphs) {
    for (const line of wrap(p, regular, 11.5, contentW)) {
      page.drawText(line, { x: MARGIN, y: y - 11.5, size: 11.5, font: regular, color: INK });
      y -= 11.5 * 1.55;
    }
    y -= 10;
  }

  y -= 24;
  const issued = sanitize(
    `En ${input.clinic.address ? input.clinic.address.split(',').slice(-1)[0]?.trim() || 'la clínica' : 'la clínica'}, a ${input.issuedOn}`,
  );
  page.drawText(issued, { x: MARGIN, y: y - 11, size: 11, font: regular, color: INK });
  y -= 70;

  // Firma.
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + 220, y },
    thickness: 0.8,
    color: RULE,
  });
  page.drawText(sanitize(input.professionalName), {
    x: MARGIN,
    y: y - 14,
    size: 11,
    font: bold,
    color: INK,
  });
  page.drawText('Firma y sello', { x: MARGIN, y: y - 28, size: 9, font: regular, color: MUTED });

  // Pie.
  const foot = sanitize(
    `${input.clinic.name}${input.clinic.address ? ` · ${input.clinic.address}` : ''}`,
  );
  page.drawText(foot, {
    x: (PAGE_W - regular.widthOfTextAtSize(foot, 8)) / 2,
    y: 36,
    size: 8,
    font: regular,
    color: MUTED,
  });

  return doc.save();
}
