// Facturas desde la ficha: lo puro.
//
// Cómo se numera una factura, cómo se agrupan las sesiones en líneas, cómo se
// suman los importes y qué se le escribe al tutor. Sin base y sin
// `server-only`: el panel, el servidor y los tests hablan el mismo idioma.

import { type PaymentMethod, formatCents, isPaymentMethod } from '@/lib/agenda/billing';
import { parseDateKey } from '@/lib/tasks/tz';

export { formatCents };

/** Los métodos de pago de la ficha, con el nombre que va impreso. */
export const INVOICE_PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  BIZUM: 'Bizum',
  TRANSFER: 'Transferencia bancaria',
};
export const INVOICE_PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'CARD', 'BIZUM', 'TRANSFER'];
export { isPaymentMethod };

export type InvoiceStatus = 'ISSUED' | 'VOID';

/** Quien emite, tal como va impreso. Se copia en cada factura al emitirla. */
export interface InvoiceIssuer {
  name: string;
  subtitle: string | null;
  taxId: string | null;
  /** Una línea por elemento. */
  addressLines: string[];
  email: string | null;
  phone: string | null;
  iban: string | null;
  logoUrl: string | null;
  tagline: string | null;
  footerLeft: string | null;
  footerCenter: string | null;
  footerRight: string | null;
  /** 0 = exento. */
  vatRate: number;
  vatNote: string | null;
}

export interface InvoiceBillTo {
  name: string;
  taxId: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
}

export interface InvoiceItem {
  concept: string;
  quantity: number;
  unitCents: number;
  /** Las citas que cubre esta línea, para marcarlas facturadas. */
  appointmentIds: string[];
}

export interface InvoiceTotals {
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
}

/** "2026-0000032": la serie es el año y el número va a siete cifras. */
export function formatInvoiceNumber(year: number, sequence: number): string {
  return `${year}-${String(sequence).padStart(7, '0')}`;
}

/** Suma de líneas e IVA (sobre la base; el importe de cada línea va sin IVA). */
export function computeTotals(items: InvoiceItem[], vatRate: number): InvoiceTotals {
  const subtotal = items.reduce((acc, it) => acc + Math.round(it.unitCents * it.quantity), 0);
  const vat = vatRate > 0 ? Math.round((subtotal * vatRate) / 100) : 0;
  return { subtotalCents: subtotal, vatCents: vat, totalCents: subtotal + vat };
}

export interface InvoiceableSession {
  appointmentId: string;
  concept: string;
  unitCents: number | null;
}

/**
 * Agrupa sesiones iguales (mismo concepto y mismo precio) en una línea con
 * cantidad: "Sesión de fisioterapia × 3" en vez de tres líneas idénticas. Las
 * que no tienen precio van a una línea aparte, a 0, para que quien factura lo
 * ponga a mano y no se le pase.
 */
export function groupSessionsIntoItems(sessions: InvoiceableSession[]): InvoiceItem[] {
  const map = new Map<string, InvoiceItem>();
  for (const s of sessions) {
    const unit = s.unitCents ?? 0;
    const key = `${s.concept.trim().toLowerCase()}|${unit}`;
    const item = map.get(key) ?? {
      concept: s.concept.trim(),
      quantity: 0,
      unitCents: unit,
      appointmentIds: [],
    };
    item.quantity += 1;
    item.appointmentIds.push(s.appointmentId);
    map.set(key, item);
  }
  return [...map.values()];
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY', como va impreso. */
export function formatDateEs(key: string): string {
  const p = parseDateKey(key);
  if (!p) return key;
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}/${p.year}`;
}

export function invoiceFileName(number: string): string {
  return `Factura-${number.replace(/[^0-9A-Za-z-]/g, '')}.pdf`;
}

/** Sólo dígitos y letras, en mayúsculas: "70055622-z" → "70055622Z". */
export function normalizeTaxId(value: string | null | undefined): string | null {
  const v = (value ?? '').replace(/[\s.-]/g, '').toUpperCase();
  return v ? v : null;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName.trim();
}

/** El WhatsApp que acompaña al PDF. */
export function buildInvoiceMessage(input: {
  tutorName: string;
  clinicName: string;
  number: string;
  totalCents: number;
  patientName: string;
}): string {
  return `Hola ${firstName(input.tutorName)}, te adjuntamos la factura ${input.number} de ${input.clinicName} (${formatCents(input.totalCents)}) por las sesiones de ${firstName(input.patientName)}. Gracias por confiar en nosotros.`;
}

/** El correo, para abrirlo ya escrito (el PDF se adjunta a mano tras descargarlo). */
export function buildInvoiceMailto(input: {
  to: string | null;
  clinicName: string;
  number: string;
  tutorName: string;
  patientName: string;
  totalCents: number;
}): string {
  const subject = `Factura ${input.number} · ${input.clinicName}`;
  const body =
    `Hola ${firstName(input.tutorName)},\n\n` +
    `Te adjunto la factura ${input.number} de ${input.clinicName} (${formatCents(input.totalCents)}) ` +
    `por las sesiones de ${firstName(input.patientName)}.\n\nUn saludo,\n${input.clinicName}`;
  const qs = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${encodeURIComponent(input.to ?? '')}?${qs}`;
}

export interface InvoiceItemInput {
  concept: string;
  quantity: number;
  /** Lo que tecleó recepción: "45", "45,50"… */
  unit: string;
  appointmentIds?: string[];
}

export class InvoiceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceValidationError';
  }
}
