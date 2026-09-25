// Cobros por cita: lo puro.
//
// La pestaña "Contable" de la ficha del paciente une dos cosas que viven
// separadas: las citas (lo que se atendió) y los cargos (lo que se cobró). Este
// módulo hace esa unión y las sumas sin tocar la base, para que el panel, el
// servidor y los tests hablen el mismo idioma. Sin `server-only` a propósito.

export const PAYMENT_METHODS = ['CARD', 'CASH', 'BIZUM', 'TRANSFER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CARD: 'Tarjeta',
  CASH: 'Efectivo',
  BIZUM: 'Bizum',
  TRANSFER: 'Transferencia',
};

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);
}

export const CHARGE_FILE_KINDS = ['INVOICE', 'RECEIPT', 'PROOF'] as const;
export type ChargeFileKind = (typeof CHARGE_FILE_KINDS)[number];

export const CHARGE_FILE_KIND_LABELS: Record<ChargeFileKind, string> = {
  INVOICE: 'Factura',
  RECEIPT: 'Comprobante',
  PROOF: 'Justificante',
};

export function isChargeFileKind(value: unknown): value is ChargeFileKind {
  return typeof value === 'string' && (CHARGE_FILE_KINDS as readonly string[]).includes(value);
}

/**
 * Qué es el archivo según lo que se sube: una factura llega en PDF y un
 * justificante de Bizum o el ticket del TPV son una foto o una captura. Es
 * lo que decide la etiqueta cuando quien adjunta no la elige.
 */
export function inferChargeFileKind(mime: string): ChargeFileKind {
  return mime === 'application/pdf' ? 'INVOICE' : 'PROOF';
}

/** Comprobantes: fotos y PDF. Nada de SVG ni de Office: se sirven dentro del panel. */
export const ALLOWED_RECEIPT_MIMES = new Set<string>([
  'image/jpeg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);
export const RECEIPT_ACCEPT = 'image/*,.pdf,application/pdf';
/** 15 MB: una foto del móvil sin comprimir cabe; un escaneo a 600 ppp no hace falta. */
export const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;

/** "Fisioterapia respiratoria · Dra. Ruiz · 1ª visita": el concepto que se cobra. */
export function describeConcept(input: {
  treatmentName: string | null;
  professionalName: string;
  isFirstVisit: boolean;
}): string {
  return [
    input.treatmentName ?? 'Sesión',
    input.professionalName,
    input.isFirstVisit ? '1ª visita' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export type ChargeStatus = 'PENDING' | 'PAID';

export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  PENDING: 'Pendiente',
  PAID: 'Pagado',
};

/** "45,00 €" en formato español. */
export function formatCents(cents: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(cents / 100);
}

/**
 * "45", "45,50", "45.5", "1.250,00", "45 €" → céntimos. Acepta coma o punto
 * como decimal: el último separador que aparece es el decimal y el resto son
 * miles. Devuelve null si no es un importe o es negativo.
 */
export function parseAmountToCents(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) : null;
  }
  const cleaned = raw.replace(/[^\d.,-]/g, '');
  if (!cleaned || cleaned.startsWith('-')) return null;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const decimalAt = Math.max(lastComma, lastDot);
  let normalized: string;
  if (decimalAt === -1) {
    normalized = cleaned;
  } else {
    const intPart = cleaned.slice(0, decimalAt).replace(/[.,]/g, '');
    const decPart = cleaned.slice(decimalAt + 1).replace(/[.,]/g, '');
    // "1.250" sin decimales de verdad: tres dígitos tras un único punto son miles.
    if (decPart.length === 3 && lastComma === -1 && cleaned.indexOf('.') === lastDot) {
      normalized = intPart + decPart;
    } else {
      normalized = `${intPart}.${decPart}`;
    }
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Céntimos → "45,50" para rellenar un campo de importe. */
export function centsToInput(cents: number | null): string {
  if (cents === null) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

export interface BillingFile {
  id: string;
  name: string;
  kind: ChargeFileKind;
}

export interface BillingAppointmentInput {
  id: string;
  startsAt: Date;
  status: string;
  concept: string;
  /** Precio del tratamiento de la cita, si el catálogo lo tiene. */
  treatmentPriceCents: number | null;
}

export interface BillingChargeInput {
  id: string;
  appointmentId: string | null;
  concept: string;
  amountCents: number | null;
  status: string;
  paymentMethod: string | null;
  paidOn: string | null;
  createdAt: Date;
  files: BillingFile[];
  invoiceId?: string | null;
}

/** Una línea de la pestaña: una cita con o sin cargo, o un cargo suelto. */
export interface BillingLine {
  /** Id estable para la UI: el del cargo si existe, si no el de la cita. */
  key: string;
  chargeId: string | null;
  appointmentId: string | null;
  /** Para ordenar: la hora de la cita, o cuándo se creó el cargo suelto. */
  at: Date;
  concept: string;
  /** null = sin importe fijado (ni cargo con importe ni precio de tratamiento). */
  amountCents: number | null;
  status: ChargeStatus;
  paymentMethod: PaymentMethod | null;
  paidOn: string | null;
  files: BillingFile[];
  /** La factura en la que va el cargo, si ya se facturó. */
  invoiceId: string | null;
}

/**
 * Une citas y cargos en las líneas de la pestaña, la más reciente arriba.
 *
 * - Una cita sin cargo sale PENDIENTE con el precio del tratamiento (si lo
 *   hay) como importe. Es lo que hace que la clínica vea qué falta cobrar sin
 *   dar de alta nada.
 * - Una cita cancelada sin cargo no sale: no hay nada que cobrar. Con cargo
 *   sí, porque un pago hecho no desaparece porque se cancele la cita.
 * - Un cargo sin cita (o cuya cita se borró) sale por su cuenta.
 */
export function buildBillingLines(input: {
  appointments: BillingAppointmentInput[];
  charges: BillingChargeInput[];
}): BillingLine[] {
  const byAppointment = new Map<string, BillingChargeInput>();
  for (const c of input.charges) {
    if (c.appointmentId) byAppointment.set(c.appointmentId, c);
  }

  const lines: BillingLine[] = [];
  const seen = new Set<string>();

  for (const a of input.appointments) {
    const charge = byAppointment.get(a.id) ?? null;
    if (!charge && a.status === 'CANCELLED') continue;
    if (charge) seen.add(charge.id);
    lines.push({
      key: charge?.id ?? a.id,
      chargeId: charge?.id ?? null,
      appointmentId: a.id,
      at: a.startsAt,
      concept: charge?.concept || a.concept,
      amountCents: charge ? charge.amountCents : a.treatmentPriceCents,
      status: charge?.status === 'PAID' ? 'PAID' : 'PENDING',
      paymentMethod: isPaymentMethod(charge?.paymentMethod) ? charge.paymentMethod : null,
      paidOn: charge?.paidOn ?? null,
      files: charge?.files ?? [],
      invoiceId: charge?.invoiceId ?? null,
    });
  }

  // Cargos sueltos y cargos cuya cita no vino en la lista (se borró): se
  // listan igual, con lo que el cargo sabe.
  for (const c of input.charges) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    lines.push({
      key: c.id,
      chargeId: c.id,
      appointmentId: c.appointmentId,
      at: c.createdAt,
      concept: c.concept,
      amountCents: c.amountCents,
      status: c.status === 'PAID' ? 'PAID' : 'PENDING',
      paymentMethod: isPaymentMethod(c.paymentMethod) ? c.paymentMethod : null,
      paidOn: c.paidOn,
      files: c.files,
      invoiceId: c.invoiceId ?? null,
    });
  }

  return lines.sort((x, y) => y.at.getTime() - x.at.getTime());
}

export interface BillingTotals {
  billedCents: number;
  paidCents: number;
  dueCents: number;
  /** Líneas sin pagar, tengan o no importe: son las que piden acción. */
  dueCount: number;
}

/** Facturado = todo lo que tiene importe; cobrado = lo pagado; pendiente = la resta. */
export function summarizeBilling(lines: BillingLine[]): BillingTotals {
  let billed = 0;
  let paid = 0;
  let dueCount = 0;
  for (const l of lines) {
    if (l.amountCents !== null) billed += l.amountCents;
    if (l.status === 'PAID' && l.amountCents !== null) paid += l.amountCents;
    if (l.status === 'PENDING') dueCount += 1;
  }
  return { billedCents: billed, paidCents: paid, dueCents: Math.max(0, billed - paid), dueCount };
}
