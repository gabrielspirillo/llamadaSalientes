import 'server-only';
import { and, desc, eq, inArray, or } from 'drizzle-orm';

import { type PaymentMethod, isPaymentMethod, parseAmountToCents } from '@/lib/agenda/billing';
import { ensureChargeForAppointment } from '@/lib/agenda/charges';
import { type Guardian, guardiansSchema } from '@/lib/care-profile/policy';
import { getTenant } from '@/lib/data/clinic';
import { db } from '@/lib/db/client';
import {
  agendaAppointments,
  clinicSettings,
  invoiceSettings,
  invoices,
  patientCharges,
  patients,
  whatsappConversations,
  whatsappMessages,
} from '@/lib/db/schema';
import { env } from '@/lib/env';
import {
  INVOICE_PAYMENT_METHOD_LABELS,
  type InvoiceBillTo,
  type InvoiceIssuer,
  type InvoiceItem,
  type InvoiceItemInput,
  InvoiceValidationError,
  buildInvoiceMessage,
  computeTotals,
  formatDateEs,
  formatInvoiceNumber,
  invoiceFileName,
  normalizeTaxId,
} from '@/lib/invoices/model';
import { renderInvoicePdf } from '@/lib/invoices/pdf';
import { mediaSignedUrl, mediaUpload } from '@/lib/storage/media';
import { parseDateKey } from '@/lib/tasks/tz';
import { getConnectorForTenant } from '@/lib/whatsapp/factory';
import { getOrCreateOpenConversation, upsertWhatsappContact } from '@/lib/whatsapp/persist';
import { parseWhatsappPhone } from '@/lib/whatsapp/phone';
import { publishMessageEvent } from '@/lib/whatsapp/realtime/publisher';
import type { WhatsAppConnector } from '@/lib/whatsapp/types';

/**
 * Facturas desde la ficha del paciente (migración 0042).
 *
 * La factura es INMUTABLE: al emitirla se copian el emisor y el destinatario
 * tal como estaban, se asigna el número dentro de una transacción con el
 * contador bloqueado (dos recepcionistas a la vez no pueden sacar el mismo),
 * se marcan las citas como facturadas y se genera el PDF con el diseño de la
 * clínica. No se borra: se anula, y el número queda.
 */

export interface InvoiceScope {
  tenantId: string;
  userId: string | null;
}

function internalBucket(): string {
  return env.S3_BUCKET_INTERNAL;
}

function emptyToNull(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

// ─── Datos del emisor ───────────────────────────────────────────────────────

export interface InvoiceSettingsRecord {
  issuerName: string | null;
  issuerSubtitle: string | null;
  taxId: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  iban: string | null;
  logoUrl: string | null;
  tagline: string | null;
  footerLeft: string | null;
  footerCenter: string | null;
  footerRight: string | null;
  vatRate: number;
  vatNote: string | null;
  defaultConcept: string | null;
  seriesYear: number | null;
  nextNumber: number;
}

export async function getInvoiceSettings(tenantId: string): Promise<InvoiceSettingsRecord | null> {
  const rows = await db
    .select()
    .from(invoiceSettings)
    .where(eq(invoiceSettings.tenantId, tenantId))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    issuerName: r.issuerName,
    issuerSubtitle: r.issuerSubtitle,
    taxId: r.taxId,
    address: r.address,
    email: r.email,
    phone: r.phone,
    iban: r.iban,
    logoUrl: r.logoUrl,
    tagline: r.tagline,
    footerLeft: r.footerLeft,
    footerCenter: r.footerCenter,
    footerRight: r.footerRight,
    vatRate: Number(r.vatRate ?? 0),
    vatNote: r.vatNote,
    defaultConcept: r.defaultConcept,
    seriesYear: r.seriesYear,
    nextNumber: r.nextNumber,
  };
}

export type InvoiceSettingsInput = Omit<
  InvoiceSettingsRecord,
  'vatRate' | 'nextNumber' | 'seriesYear'
> & {
  vatRate: number;
  seriesYear: number | null;
  nextNumber: number;
};

export async function saveInvoiceSettings(
  scope: InvoiceScope,
  input: InvoiceSettingsInput,
): Promise<void> {
  if (!Number.isFinite(input.vatRate) || input.vatRate < 0 || input.vatRate > 100) {
    throw new InvoiceValidationError('El tipo de IVA no es válido.');
  }
  if (!Number.isInteger(input.nextNumber) || input.nextNumber < 1) {
    throw new InvoiceValidationError('El próximo número tiene que ser 1 o más.');
  }
  if (
    input.seriesYear !== null &&
    (!Number.isInteger(input.seriesYear) || input.seriesYear < 2000 || input.seriesYear > 2100)
  ) {
    throw new InvoiceValidationError('El año de la serie no es válido.');
  }
  if (input.logoUrl && !/^https:\/\//i.test(input.logoUrl.trim())) {
    throw new InvoiceValidationError('El logo tiene que ser una URL https.');
  }
  const values = {
    issuerName: emptyToNull(input.issuerName),
    issuerSubtitle: emptyToNull(input.issuerSubtitle),
    taxId: emptyToNull(input.taxId),
    address: emptyToNull(input.address),
    email: emptyToNull(input.email),
    phone: emptyToNull(input.phone),
    iban: emptyToNull(input.iban),
    logoUrl: emptyToNull(input.logoUrl),
    tagline: emptyToNull(input.tagline),
    footerLeft: emptyToNull(input.footerLeft),
    footerCenter: emptyToNull(input.footerCenter),
    footerRight: emptyToNull(input.footerRight),
    vatRate: String(input.vatRate),
    vatNote: emptyToNull(input.vatNote),
    defaultConcept: emptyToNull(input.defaultConcept),
    seriesYear: input.seriesYear,
    nextNumber: input.nextNumber,
    updatedAt: new Date(),
  };
  await db
    .insert(invoiceSettings)
    .values({ tenantId: scope.tenantId, ...values })
    .onConflictDoUpdate({ target: invoiceSettings.tenantId, set: values });
}

export interface InvoiceContext {
  issuer: InvoiceIssuer;
  defaultConcept: string | null;
  clinicName: string;
}

/**
 * Quien emite, con los huecos rellenos desde la clínica: sin fila de ajustes
 * se factura a nombre de la clínica, con su dirección y su logo si los tiene.
 */
export async function getInvoiceContext(tenantId: string): Promise<InvoiceContext> {
  const [settings, tenant, clinicRows] = await Promise.all([
    getInvoiceSettings(tenantId),
    getTenant(tenantId),
    db.select().from(clinicSettings).where(eq(clinicSettings.tenantId, tenantId)).limit(1),
  ]);
  const clinic = clinicRows[0] ?? null;
  const clinicName = tenant?.name?.trim() || 'la clínica';
  const addressLines = settings?.address
    ? settings.address
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    : clinic?.address
      ? [clinic.address]
      : [];
  return {
    clinicName,
    defaultConcept: settings?.defaultConcept ?? null,
    issuer: {
      name: settings?.issuerName ?? clinicName,
      subtitle: settings?.issuerSubtitle ?? null,
      taxId: settings?.taxId ?? null,
      addressLines,
      email: settings?.email ?? null,
      phone: settings?.phone ?? clinic?.phones?.[0] ?? null,
      iban: settings?.iban ?? null,
      logoUrl: settings?.logoUrl ?? tenant?.logoUrl ?? null,
      tagline: settings?.tagline ?? null,
      footerLeft: settings?.footerLeft ?? clinicName,
      footerCenter: settings?.footerCenter ?? null,
      footerRight: settings?.footerRight ?? null,
      vatRate: settings?.vatRate ?? 0,
      vatNote: settings?.vatNote ?? null,
    },
  };
}

// ─── PDF ────────────────────────────────────────────────────────────────────

async function fetchLogo(
  url: string | null,
): Promise<{ bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' } | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > 4 * 1024 * 1024) return null;
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
      return { bytes, mime: 'image/png' };
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
      return { bytes, mime: 'image/jpeg' };
    return null;
  } catch {
    return null;
  }
}

type InvoiceRow = typeof invoices.$inferSelect;

function issuerFromRow(row: InvoiceRow): InvoiceIssuer {
  const i = (row.issuer ?? {}) as Partial<InvoiceIssuer>;
  return {
    name: i.name ?? '',
    subtitle: i.subtitle ?? null,
    taxId: i.taxId ?? null,
    addressLines: Array.isArray(i.addressLines) ? i.addressLines : [],
    email: i.email ?? null,
    phone: i.phone ?? null,
    iban: i.iban ?? null,
    logoUrl: i.logoUrl ?? null,
    tagline: i.tagline ?? null,
    footerLeft: i.footerLeft ?? null,
    footerCenter: i.footerCenter ?? null,
    footerRight: i.footerRight ?? null,
    vatRate: Number(i.vatRate ?? 0),
    vatNote: i.vatNote ?? null,
  };
}

/** Genera el PDF de una factura y lo guarda en el bucket interno. Devuelve la key. */
async function generateAndStorePdf(row: InvoiceRow): Promise<string> {
  const issuer = issuerFromRow(row);
  const logo = await fetchLogo(issuer.logoUrl);
  const items = (row.items ?? []).map((it) => ({
    concept: it.concept,
    quantity: it.quantity,
    unitCents: it.unitCents,
    appointmentIds: it.appointmentIds ?? [],
  }));
  const bytes = await renderInvoicePdf({
    number: row.number,
    issuedOn: formatDateEs(row.issuedOn),
    issuer,
    billTo: {
      name: row.billToName,
      taxId: row.billToTaxId,
      address: row.billToAddress,
      email: row.billToEmail,
      phone: row.billToPhone,
    },
    patientName: row.patientName,
    items,
    totals: {
      subtotalCents: row.subtotalCents,
      vatCents: row.vatCents,
      totalCents: row.totalCents,
    },
    vatRate: Number(row.vatRate ?? 0),
    paymentMethodLabel: isPaymentMethod(row.paymentMethod)
      ? INVOICE_PAYMENT_METHOD_LABELS[row.paymentMethod]
      : null,
    showIban: row.paymentMethod === 'TRANSFER',
    notes: row.notes,
    voided: row.status === 'VOID',
    logo,
  });
  const key = `tenants/${row.tenantId}/invoices/${row.id}.pdf`;
  await mediaUpload({
    bucket: internalBucket(),
    path: key,
    body: bytes,
    contentType: 'application/pdf',
  });
  await db
    .update(invoices)
    .set({ pdfKey: key, updatedAt: new Date() })
    .where(and(eq(invoices.tenantId, row.tenantId), eq(invoices.id, row.id)));
  return key;
}

async function findInvoice(tenantId: string, id: string): Promise<InvoiceRow | null> {
  if (!isUuid(id)) return null;
  const rows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/** La key del PDF, generándolo si al emitir no se pudo. */
export async function ensureInvoicePdf(tenantId: string, id: string): Promise<string | null> {
  const row = await findInvoice(tenantId, id);
  if (!row) return null;
  if (row.pdfKey) return row.pdfKey;
  return generateAndStorePdf(row);
}

/**
 * URL firmada del PDF (10 min), contra la URL pública del bucket. Con
 * `download`, el bucket manda el archivo como adjunto con su nombre.
 */
export async function invoicePdfSignedUrl(
  tenantId: string,
  id: string,
  opts: { download?: boolean; expiresInSeconds?: number } = {},
): Promise<string | null> {
  const row = await findInvoice(tenantId, id);
  if (!row) return null;
  const key = row.pdfKey ?? (await generateAndStorePdf(row));
  return mediaSignedUrl(key, {
    bucket: internalBucket(),
    expiresInSeconds: opts.expiresInSeconds ?? 60 * 10,
    publicHost: true,
    downloadName: opts.download ? invoiceFileName(row.number) : undefined,
  });
}

// ─── Emitir ─────────────────────────────────────────────────────────────────

export interface IssueInvoiceInput {
  patientKey: string;
  patientId: string | null;
  patientName: string;
  billTo: InvoiceBillTo;
  items: InvoiceItemInput[];
  paymentMethod: PaymentMethod | null;
  /** 'YYYY-MM-DD' */
  issuedOn: string;
  notes: string | null;
  /** Las sesiones pendientes de cobro se marcan cobradas con esta forma y esta fecha. */
  registerPayment: boolean;
  /** Guardar NIF, dirección, correo y teléfono en el tutor de la ficha. */
  rememberBillTo: boolean;
}

export interface IssueInvoiceResult {
  id: string;
  number: string;
  totalCents: number;
  pdfOk: boolean;
  warning?: string;
}

function normalizeItems(raw: InvoiceItemInput[]): InvoiceItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new InvoiceValidationError('La factura necesita al menos una línea.');
  }
  if (raw.length > 40) throw new InvoiceValidationError('Demasiadas líneas para una factura.');
  return raw.map((it) => {
    const concept = (it.concept ?? '').trim().slice(0, 200);
    if (!concept) throw new InvoiceValidationError('Hay una línea sin concepto.');
    const quantity = Number(it.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      throw new InvoiceValidationError(`La cantidad de «${concept}» no es válida.`);
    }
    const unitCents = parseAmountToCents(it.unit);
    if (unitCents === null)
      throw new InvoiceValidationError(`El precio de «${concept}» no es válido.`);
    const appointmentIds = (it.appointmentIds ?? []).filter(isUuid);
    return { concept, quantity, unitCents, appointmentIds };
  });
}

export async function issueInvoice(
  scope: InvoiceScope,
  input: IssueInvoiceInput,
): Promise<IssueInvoiceResult> {
  const billToName = (input.billTo?.name ?? '').trim().slice(0, 160);
  if (!billToName) throw new InvoiceValidationError('Falta el nombre de a quién se factura.');
  if (!parseDateKey(input.issuedOn))
    throw new InvoiceValidationError('La fecha de la factura no es válida.');
  if (input.paymentMethod !== null && !isPaymentMethod(input.paymentMethod)) {
    throw new InvoiceValidationError('La forma de pago no es válida.');
  }
  const patientName = (input.patientName ?? '').trim().slice(0, 160);
  if (!patientName) throw new InvoiceValidationError('Falta el nombre del paciente.');
  const items = normalizeItems(input.items);
  const billTo: InvoiceBillTo = {
    name: billToName,
    taxId: normalizeTaxId(input.billTo.taxId),
    address: emptyToNull(input.billTo.address)?.slice(0, 240) ?? null,
    email: emptyToNull(input.billTo.email)?.slice(0, 160) ?? null,
    phone: emptyToNull(input.billTo.phone)?.slice(0, 40) ?? null,
  };
  const patientId = input.patientId && isUuid(input.patientId) ? input.patientId : null;

  // Las citas tienen que ser de esta clínica y de este paciente, y no estar ya
  // en otra factura viva.
  const appointmentIds = [...new Set(items.flatMap((it) => it.appointmentIds))];
  if (appointmentIds.length > 0) {
    const rows = await db
      .select({
        id: agendaAppointments.id,
        patientKey: agendaAppointments.patientKey,
        patientId: agendaAppointments.patientId,
      })
      .from(agendaAppointments)
      .where(
        and(
          eq(agendaAppointments.tenantId, scope.tenantId),
          inArray(agendaAppointments.id, appointmentIds),
        ),
      );
    if (rows.length !== appointmentIds.length)
      throw new InvoiceValidationError('Alguna de las citas ya no existe.');
    for (const r of rows) {
      const sameKey = r.patientKey === input.patientKey;
      const samePerson = patientId !== null && r.patientId === patientId;
      if (!sameKey && !samePerson)
        throw new InvoiceValidationError('Una de las citas no es de este paciente.');
    }
    const invoiced = await db
      .select({ appointmentId: patientCharges.appointmentId, number: invoices.number })
      .from(patientCharges)
      .innerJoin(invoices, eq(invoices.id, patientCharges.invoiceId))
      .where(
        and(
          eq(patientCharges.tenantId, scope.tenantId),
          inArray(patientCharges.appointmentId, appointmentIds),
          eq(invoices.status, 'ISSUED'),
        ),
      );
    if (invoiced[0])
      throw new InvoiceValidationError(
        `Una de las sesiones ya está en la factura ${invoiced[0].number}.`,
      );
  }

  // Cada cita necesita su cargo para colgar la factura de él.
  const chargeByAppointment = new Map<
    string,
    { id: string; status: string; amountCents: number | null }
  >();
  for (const appointmentId of appointmentIds) {
    const { id } = await ensureChargeForAppointment(scope, appointmentId);
    chargeByAppointment.set(appointmentId, { id, status: 'PENDING', amountCents: null });
  }
  if (chargeByAppointment.size > 0) {
    const chargeRows = await db
      .select({
        id: patientCharges.id,
        appointmentId: patientCharges.appointmentId,
        status: patientCharges.status,
        amountCents: patientCharges.amountCents,
      })
      .from(patientCharges)
      .where(
        and(
          eq(patientCharges.tenantId, scope.tenantId),
          inArray(
            patientCharges.id,
            [...chargeByAppointment.values()].map((c) => c.id),
          ),
        ),
      );
    for (const c of chargeRows) {
      if (c.appointmentId)
        chargeByAppointment.set(c.appointmentId, {
          id: c.id,
          status: c.status,
          amountCents: c.amountCents,
        });
    }
  }
  const unitByAppointment = new Map<string, number>();
  for (const it of items) for (const a of it.appointmentIds) unitByAppointment.set(a, it.unitCents);

  const context = await getInvoiceContext(scope.tenantId);
  const vatRate = context.issuer.vatRate;
  const totals = computeTotals(items, vatRate);
  const year = Number(input.issuedOn.slice(0, 4));

  // El contador vive en la fila de ajustes: si no existe, se crea con la serie de este año.
  await db
    .insert(invoiceSettings)
    .values({ tenantId: scope.tenantId, seriesYear: year, nextNumber: 1 })
    .onConflictDoNothing();

  const issued = await db.transaction(async (tx) => {
    const [settings] = await tx
      .select({ seriesYear: invoiceSettings.seriesYear, nextNumber: invoiceSettings.nextNumber })
      .from(invoiceSettings)
      .where(eq(invoiceSettings.tenantId, scope.tenantId))
      .for('update');
    const sequence = settings && settings.seriesYear === year ? settings.nextNumber : 1;
    const number = formatInvoiceNumber(year, sequence);
    await tx
      .update(invoiceSettings)
      .set({ seriesYear: year, nextNumber: sequence + 1, updatedAt: new Date() })
      .where(eq(invoiceSettings.tenantId, scope.tenantId));

    const [row] = await tx
      .insert(invoices)
      .values({
        tenantId: scope.tenantId,
        number,
        issuedOn: input.issuedOn,
        status: 'ISSUED',
        patientKey: input.patientKey,
        patientId,
        patientName,
        billToName: billTo.name,
        billToTaxId: billTo.taxId,
        billToAddress: billTo.address,
        billToEmail: billTo.email,
        billToPhone: billTo.phone,
        items,
        subtotalCents: totals.subtotalCents,
        vatRate: String(vatRate),
        vatCents: totals.vatCents,
        totalCents: totals.totalCents,
        paymentMethod: input.paymentMethod,
        notes: emptyToNull(input.notes)?.slice(0, 500) ?? null,
        issuer: context.issuer as unknown as Record<string, unknown>,
        createdByUserId: scope.userId,
      })
      .returning();
    if (!row) throw new InvoiceValidationError('No se pudo guardar la factura.');

    for (const [appointmentId, charge] of chargeByAppointment) {
      const pay = input.registerPayment && charge.status !== 'PAID' && input.paymentMethod;
      await tx
        .update(patientCharges)
        .set({
          invoiceId: row.id,
          updatedAt: new Date(),
          ...(pay
            ? {
                status: 'PAID',
                amountCents: charge.amountCents ?? unitByAppointment.get(appointmentId) ?? 0,
                paidOn: input.issuedOn,
                paymentMethod: input.paymentMethod,
                paidByUserId: scope.userId,
              }
            : {}),
        })
        .where(and(eq(patientCharges.tenantId, scope.tenantId), eq(patientCharges.id, charge.id)));
    }
    return row;
  });

  // El PDF y el recuerdo de los datos del tutor: si fallan, la factura ya
  // existe y se avisa; el PDF se vuelve a intentar al bajarlo.
  let pdfOk = true;
  let warning: string | undefined;
  try {
    await generateAndStorePdf(issued);
  } catch (err) {
    pdfOk = false;
    warning =
      'La factura quedó emitida, pero el PDF no se pudo generar ahora. Se generará al descargarla.';
    console.error('[facturas] no se pudo generar el PDF al emitir', {
      id: issued.id,
      err: (err as Error).message,
    });
  }
  if (input.rememberBillTo && patientId) {
    await rememberBillTo(scope.tenantId, patientId, billTo).catch((err) =>
      console.warn('[facturas] no se pudieron guardar los datos del tutor', (err as Error).message),
    );
  }
  return { id: issued.id, number: issued.number, totalCents: issued.totalCents, pdfOk, warning };
}

/** Guarda NIF, dirección, correo y teléfono en el tutor titular para la próxima. */
async function rememberBillTo(
  tenantId: string,
  patientId: string,
  billTo: InvoiceBillTo,
): Promise<void> {
  const rows = await db
    .select({ guardians: patients.guardians })
    .from(patients)
    .where(and(eq(patients.tenantId, tenantId), eq(patients.id, patientId)))
    .limit(1);
  const parsed = guardiansSchema.safeParse(rows[0]?.guardians ?? []);
  if (!parsed.success) return;
  const guardians: Guardian[] = parsed.data;
  const idx = (() => {
    const byName = guardians.findIndex(
      (g) => g.name.trim().toLowerCase() === billTo.name.trim().toLowerCase(),
    );
    if (byName >= 0) return byName;
    return guardians.findIndex((g) => g.primary);
  })();
  if (idx < 0) return;
  const g = guardians[idx] as Guardian;
  guardians[idx] = {
    ...g,
    taxId: billTo.taxId ?? g.taxId,
    address: billTo.address ?? g.address,
    email: billTo.email ?? g.email,
    phone: g.phone?.trim() ? g.phone : (billTo.phone ?? g.phone),
  };
  await db
    .update(patients)
    .set({ guardians, updatedAt: new Date() })
    .where(and(eq(patients.tenantId, tenantId), eq(patients.id, patientId)));
}

// ─── Listar ─────────────────────────────────────────────────────────────────

export interface InvoiceSummary {
  id: string;
  number: string;
  issuedOn: string;
  status: 'ISSUED' | 'VOID';
  totalCents: number;
  billToName: string;
  billToPhone: string | null;
  billToEmail: string | null;
  paymentMethod: PaymentMethod | null;
  hasPdf: boolean;
  whatsappSentAt: Date | null;
  items: { concept: string; quantity: number; unitCents: number }[];
}

export async function listPatientInvoices(
  tenantId: string,
  patientKey: string,
  patientId: string | null = null,
): Promise<InvoiceSummary[]> {
  const byPatient =
    patientId && isUuid(patientId)
      ? or(eq(invoices.patientKey, patientKey), eq(invoices.patientId, patientId))
      : eq(invoices.patientKey, patientKey);
  const rows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), byPatient))
    .orderBy(desc(invoices.issuedOn), desc(invoices.createdAt))
    .limit(200);
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    issuedOn: r.issuedOn,
    status: r.status === 'VOID' ? 'VOID' : 'ISSUED',
    totalCents: r.totalCents,
    billToName: r.billToName,
    billToPhone: r.billToPhone,
    billToEmail: r.billToEmail,
    paymentMethod: isPaymentMethod(r.paymentMethod) ? r.paymentMethod : null,
    hasPdf: Boolean(r.pdfKey),
    whatsappSentAt: r.whatsappSentAt,
    items: (r.items ?? []).map((it) => ({
      concept: it.concept,
      quantity: it.quantity,
      unitCents: it.unitCents,
    })),
  }));
}

// ─── Enviar por WhatsApp ────────────────────────────────────────────────────

function channelOf(
  connector: WhatsAppConnector,
): 'WHATSAPP_CLOUD' | 'WHATSAPP_EVOLUTION' | 'WHATSAPP_TWILIO' {
  switch (connector.channel) {
    case 'whatsapp_cloud':
      return 'WHATSAPP_CLOUD';
    case 'whatsapp_twilio':
      return 'WHATSAPP_TWILIO';
    default:
      return 'WHATSAPP_EVOLUTION';
  }
}

/**
 * Manda el PDF por el WhatsApp de la clínica, firmado como equipo, y deja el
 * mensaje en el inbox. El enlace que ve el proveedor es una URL firmada de
 * 24 h contra la URL pública del bucket.
 */
export async function sendInvoiceWhatsapp(
  scope: InvoiceScope,
  invoiceId: string,
  phoneRaw: string,
  opts: { connector?: WhatsAppConnector | null } = {},
): Promise<{ patientKey: string; number: string }> {
  const row = await findInvoice(scope.tenantId, invoiceId);
  if (!row) throw new InvoiceValidationError('Esa factura no existe.');
  if (row.status === 'VOID') throw new InvoiceValidationError('Una factura anulada no se envía.');
  const phone = parseWhatsappPhone(phoneRaw);
  if (!phone.ok) throw new InvoiceValidationError(phone.error);

  const connector =
    opts.connector === undefined
      ? await getConnectorForTenant(scope.tenantId).catch(() => null)
      : opts.connector;
  if (!connector) {
    throw new InvoiceValidationError(
      'La clínica no tiene WhatsApp conectado. Descarga el PDF y mándalo a mano.',
    );
  }

  const key = row.pdfKey ?? (await generateAndStorePdf(row));
  const url = await mediaSignedUrl(key, {
    bucket: internalBucket(),
    expiresInSeconds: 60 * 60 * 24,
    publicHost: true,
    downloadName: invoiceFileName(row.number),
  });
  const [tenant] = await Promise.all([getTenant(scope.tenantId)]);
  const text = buildInvoiceMessage({
    tutorName: row.billToName,
    clinicName: tenant?.name?.trim() || 'la clínica',
    number: row.number,
    totalCents: row.totalCents,
    patientName: row.patientName,
  });

  const contact = await upsertWhatsappContact({
    tenantId: scope.tenantId,
    phoneE164: phone.e164,
    name: row.billToName,
  });
  const conversation = await getOrCreateOpenConversation({
    tenantId: scope.tenantId,
    contactId: contact.id,
    channel: channelOf(connector),
  });
  const sent = await connector.sendMedia(phone.e164, 'document', url, {
    caption: text,
    filename: invoiceFileName(row.number),
    mimeType: 'application/pdf',
  });

  // En el inbox: un PDF mandado por el equipo, con el enlace de siempre (la
  // ruta firma una URL nueva en cada lectura; la firmada de arriba caduca).
  const [inserted] = await db
    .insert(whatsappMessages)
    .values({
      tenantId: scope.tenantId,
      conversationId: conversation.id,
      externalId: sent.id,
      direction: 'OUTBOUND',
      type: 'PDF',
      senderType: 'HUMAN',
      contentText: text,
      mediaUrl: `/api/facturas/${row.id}/pdf`,
      mediaType: 'application/pdf',
      rawJson: { channel: channelOf(connector), kind: 'invoice', invoiceId: row.id } as never,
    })
    .onConflictDoNothing({ target: [whatsappMessages.conversationId, whatsappMessages.externalId] })
    .returning();
  await db
    .update(whatsappConversations)
    .set({ lastMsgAt: new Date(), updatedAt: new Date() })
    .where(eq(whatsappConversations.id, conversation.id));
  if (inserted) await publishMessageEvent(inserted).catch(() => undefined);

  await db
    .update(invoices)
    .set({ whatsappMessageId: sent.id, whatsappSentAt: new Date(), updatedAt: new Date() })
    .where(and(eq(invoices.tenantId, scope.tenantId), eq(invoices.id, row.id)));
  return { patientKey: row.patientKey, number: row.number };
}

// ─── Anular ─────────────────────────────────────────────────────────────────

/**
 * Anula: el número queda, la factura se marca, las sesiones vuelven a ser
 * facturables y el PDF se regenera con la marca "ANULADA".
 */
export async function voidInvoice(
  scope: InvoiceScope,
  invoiceId: string,
  reason: string,
): Promise<{ patientKey: string; number: string }> {
  const row = await findInvoice(scope.tenantId, invoiceId);
  if (!row) throw new InvoiceValidationError('Esa factura no existe.');
  if (row.status === 'VOID') throw new InvoiceValidationError('Esa factura ya está anulada.');
  const why = emptyToNull(reason)?.slice(0, 300) ?? null;
  const [updated] = await db
    .update(invoices)
    .set({ status: 'VOID', voidReason: why, voidedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(invoices.tenantId, scope.tenantId), eq(invoices.id, row.id)))
    .returning();
  await db
    .update(patientCharges)
    .set({ invoiceId: null, updatedAt: new Date() })
    .where(and(eq(patientCharges.tenantId, scope.tenantId), eq(patientCharges.invoiceId, row.id)));
  if (updated) {
    await generateAndStorePdf(updated).catch((err) =>
      console.warn('[facturas] no se pudo regenerar el PDF anulado', (err as Error).message),
    );
  }
  return { patientKey: row.patientKey, number: row.number };
}
