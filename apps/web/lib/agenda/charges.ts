import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { AgendaForbiddenError } from '@/lib/agenda/auth';
import {
  type ChargeFileKind,
  type PaymentMethod,
  describeConcept,
  isChargeFileKind,
  isPaymentMethod,
} from '@/lib/agenda/billing';
import { patientIdFromKey } from '@/lib/agenda/patients';
import { AgendaValidationError } from '@/lib/agenda/service';
import { db } from '@/lib/db/client';
import {
  agendaAppointments,
  patientChargeFiles,
  patientCharges,
  professionals,
  treatments,
} from '@/lib/db/schema';
import { env } from '@/lib/env';
import { mediaSignedUrl, mediaUpload } from '@/lib/storage/media';

/**
 * Cobros por cita y sus comprobantes (migración 0034).
 *
 * Un cargo por cita: registrar el pago dos veces actualiza el mismo. Los
 * comprobantes van al bucket interno —una factura lleva nombre y DNI del
 * tutor— y la URL se firma en cada lectura.
 */

export interface ChargeScope {
  tenantId: string;
  userId: string | null;
}

export interface ChargeFileRecord {
  id: string;
  kind: ChargeFileKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface ChargeRecord {
  id: string;
  patientKey: string;
  appointmentId: string | null;
  concept: string;
  amountCents: number | null;
  currency: string;
  status: string;
  paymentMethod: string | null;
  paidOn: string | null;
  /** La factura en la que va (migración 0042). Null = sin facturar. */
  invoiceId: string | null;
  createdAt: Date;
  files: ChargeFileRecord[];
}

function internalBucket(): string {
  return env.S3_BUCKET_INTERNAL;
}

/**
 * Los cargos de un paciente con sus comprobantes. Un profesional con acceso
 * restringido sólo ve los de SUS citas: un cargo suelto o de otra consulta no
 * es suyo.
 */
export async function listPatientCharges(
  tenantId: string,
  patientKey: string,
  opts: { viewerProfessionalId?: string | null } = {},
): Promise<ChargeRecord[]> {
  const where = [eq(patientCharges.tenantId, tenantId), eq(patientCharges.patientKey, patientKey)];
  if (opts.viewerProfessionalId) {
    where.push(eq(agendaAppointments.professionalId, opts.viewerProfessionalId));
  }
  const rows = await db
    .select({ charge: patientCharges })
    .from(patientCharges)
    .leftJoin(agendaAppointments, eq(agendaAppointments.id, patientCharges.appointmentId))
    .where(and(...where))
    .orderBy(desc(patientCharges.createdAt))
    .limit(300);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.charge.id);
  const fileRows = await db
    .select()
    .from(patientChargeFiles)
    .where(
      and(eq(patientChargeFiles.tenantId, tenantId), inArray(patientChargeFiles.chargeId, ids)),
    )
    .orderBy(asc(patientChargeFiles.createdAt));
  const filesByCharge = new Map<string, ChargeFileRecord[]>();
  for (const f of fileRows) {
    const list = filesByCharge.get(f.chargeId) ?? [];
    list.push({
      id: f.id,
      kind: isChargeFileKind(f.kind) ? f.kind : 'RECEIPT',
      fileName: f.fileName,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      createdAt: f.createdAt,
    });
    filesByCharge.set(f.chargeId, list);
  }

  return rows.map(({ charge }) => ({
    id: charge.id,
    patientKey: charge.patientKey,
    appointmentId: charge.appointmentId,
    concept: charge.concept,
    amountCents: charge.amountCents,
    currency: charge.currency,
    status: charge.status,
    paymentMethod: charge.paymentMethod,
    paidOn: charge.paidOn,
    invoiceId: charge.invoiceId ?? null,
    createdAt: charge.createdAt,
    files: filesByCharge.get(charge.id) ?? [],
  }));
}

interface AppointmentForCharge {
  id: string;
  patientKey: string;
  patientId: string | null;
  professionalId: string;
  concept: string;
  treatmentPriceCents: number | null;
}

/** La cita a cobrar, con lo que hace falta para el concepto y el importe. */
async function loadAppointmentForCharge(
  tenantId: string,
  appointmentId: string,
): Promise<AppointmentForCharge> {
  const rows = await db
    .select({
      id: agendaAppointments.id,
      patientKey: agendaAppointments.patientKey,
      patientId: agendaAppointments.patientId,
      professionalId: agendaAppointments.professionalId,
      isFirstVisit: agendaAppointments.isFirstVisit,
      professionalName: professionals.fullName,
      treatmentName: treatments.name,
      treatmentPriceCents: treatments.priceCents,
    })
    .from(agendaAppointments)
    .innerJoin(professionals, eq(professionals.id, agendaAppointments.professionalId))
    .leftJoin(treatments, eq(treatments.id, agendaAppointments.treatmentId))
    .where(and(eq(agendaAppointments.tenantId, tenantId), eq(agendaAppointments.id, appointmentId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AgendaValidationError('Esa cita ya no existe.');
  return {
    id: row.id,
    patientKey: row.patientKey,
    patientId: row.patientId,
    professionalId: row.professionalId,
    concept: describeConcept(row),
    treatmentPriceCents: row.treatmentPriceCents ?? null,
  };
}

/**
 * Quien va a escribir sobre una cita tiene que poder tocarla: de este tenant
 * y, si mira sólo su agenda, suya.
 */
export async function assertChargeAppointmentInScope(
  tenantId: string,
  appointmentId: string,
  onlyProfessionalId?: string | null,
): Promise<AppointmentForCharge> {
  const appointment = await loadAppointmentForCharge(tenantId, appointmentId);
  if (onlyProfessionalId && appointment.professionalId !== onlyProfessionalId) {
    throw new AgendaForbiddenError('Esa cita no es de tu agenda.');
  }
  return appointment;
}

/**
 * Un cargo que llega por id: de este tenant y, si quien escribe sólo ve su
 * agenda, de una cita suya. Un cargo suelto no es de nadie en particular, así
 * que a un profesional restringido no se le deja tocarlo.
 */
export async function assertChargeInScope(
  tenantId: string,
  chargeId: string,
  onlyProfessionalId?: string | null,
): Promise<void> {
  const rows = await db
    .select({ id: patientCharges.id, professionalId: agendaAppointments.professionalId })
    .from(patientCharges)
    .leftJoin(agendaAppointments, eq(agendaAppointments.id, patientCharges.appointmentId))
    .where(and(eq(patientCharges.tenantId, tenantId), eq(patientCharges.id, chargeId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AgendaValidationError('Ese cargo ya no existe.');
  if (onlyProfessionalId && row.professionalId !== onlyProfessionalId) {
    throw new AgendaForbiddenError('Ese cobro no es de tu agenda.');
  }
}

async function findChargeByAppointment(tenantId: string, appointmentId: string) {
  const rows = await db
    .select()
    .from(patientCharges)
    .where(
      and(eq(patientCharges.tenantId, tenantId), eq(patientCharges.appointmentId, appointmentId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function findChargeById(tenantId: string, chargeId: string) {
  const rows = await db
    .select()
    .from(patientCharges)
    .where(and(eq(patientCharges.tenantId, tenantId), eq(patientCharges.id, chargeId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * El cargo de una cita, creándolo PENDIENTE si no existe. Es lo que permite
 * adjuntar la factura antes de registrar el pago: el comprobante necesita
 * dónde colgar. El importe sale del precio del tratamiento, o queda sin fijar.
 */
export async function ensureChargeForAppointment(
  scope: ChargeScope,
  appointmentId: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await findChargeByAppointment(scope.tenantId, appointmentId);
  if (existing) return { id: existing.id, created: false };

  const appointment = await loadAppointmentForCharge(scope.tenantId, appointmentId);
  const [row] = await db
    .insert(patientCharges)
    .values({
      tenantId: scope.tenantId,
      patientKey: appointment.patientKey,
      patientId: appointment.patientId ?? patientIdFromKey(appointment.patientKey),
      appointmentId,
      concept: appointment.concept,
      amountCents: appointment.treatmentPriceCents,
      status: 'PENDING',
      createdByUserId: scope.userId,
    })
    // Dos pestañas adjuntando a la vez: la segunda encuentra el cargo de la
    // primera en vez de reventar por el único.
    .onConflictDoNothing()
    .returning({ id: patientCharges.id });
  if (row) return { id: row.id, created: true };
  const raced = await findChargeByAppointment(scope.tenantId, appointmentId);
  if (!raced) throw new AgendaValidationError('No se pudo crear el cargo de la cita.');
  return { id: raced.id, created: false };
}

export interface RegisterPaymentInput {
  /** La cita cobrada, o el cargo (suelto o ya creado) al que se le registra el pago. */
  appointmentId?: string | null;
  chargeId?: string | null;
  amountCents: number;
  /** 'YYYY-MM-DD'. */
  paidOn: string;
  paymentMethod: PaymentMethod;
}

/**
 * Registra el pago: el cargo pasa a PAGADO con importe, método y fecha. Sobre
 * una cita sin cargo lo crea; sobre uno ya pagado lo corrige (mismo cargo,
 * nunca dos).
 */
export async function registerPayment(
  scope: ChargeScope,
  input: RegisterPaymentInput,
): Promise<{ chargeId: string; patientKey: string }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    throw new AgendaValidationError('El importe no es válido.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn)) {
    throw new AgendaValidationError('La fecha de pago no es válida.');
  }
  if (!isPaymentMethod(input.paymentMethod)) {
    throw new AgendaValidationError('Elige cómo se pagó.');
  }

  let chargeId: string;
  if (input.chargeId) {
    const charge = await findChargeById(scope.tenantId, input.chargeId);
    if (!charge) throw new AgendaValidationError('Ese cargo ya no existe.');
    chargeId = charge.id;
  } else if (input.appointmentId) {
    chargeId = (await ensureChargeForAppointment(scope, input.appointmentId)).id;
  } else {
    throw new AgendaValidationError('Falta la cita que se cobra.');
  }

  const [row] = await db
    .update(patientCharges)
    .set({
      amountCents: input.amountCents,
      status: 'PAID',
      paymentMethod: input.paymentMethod,
      paidOn: input.paidOn,
      paidByUserId: scope.userId,
      updatedAt: new Date(),
    })
    .where(and(eq(patientCharges.tenantId, scope.tenantId), eq(patientCharges.id, chargeId)))
    .returning({ id: patientCharges.id, patientKey: patientCharges.patientKey });
  if (!row) throw new AgendaValidationError('No se pudo registrar el pago.');
  return { chargeId: row.id, patientKey: row.patientKey };
}

/** Extensión segura para la key del bucket. */
function extensionFor(fileName: string, mime: string): string {
  const fromName = fileName
    .split('.')
    .pop()
    ?.replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
  if (fromName && fromName.length <= 5 && fromName !== fileName.toLowerCase()) return fromName;
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/heic' || mime === 'image/heif') return 'heic';
  return 'jpg';
}

/** Sube el comprobante al bucket interno y lo cuelga del cargo. */
export async function attachChargeFile(
  scope: ChargeScope,
  input: {
    chargeId: string;
    kind: ChargeFileKind;
    fileName: string;
    mimeType: string;
    body: Buffer;
  },
): Promise<{ id: string; patientKey: string }> {
  const charge = await findChargeById(scope.tenantId, input.chargeId);
  if (!charge) throw new AgendaValidationError('Ese cargo ya no existe.');

  const key = `tenants/${scope.tenantId}/charges/${charge.id}/${randomUUID()}.${extensionFor(
    input.fileName,
    input.mimeType,
  )}`;
  await mediaUpload({
    bucket: internalBucket(),
    path: key,
    body: input.body,
    contentType: input.mimeType,
  });

  const [row] = await db
    .insert(patientChargeFiles)
    .values({
      tenantId: scope.tenantId,
      chargeId: charge.id,
      kind: input.kind,
      fileName: input.fileName.slice(0, 200),
      storageKey: key,
      mimeType: input.mimeType,
      sizeBytes: input.body.byteLength,
      uploadedByUserId: scope.userId,
    })
    .returning({ id: patientChargeFiles.id });
  if (!row) throw new AgendaValidationError('No se pudo guardar el comprobante.');
  return { id: row.id, patientKey: charge.patientKey };
}

/**
 * URL firmada (10 min) de un comprobante. Se busca por (clínica, id) y, si
 * quien mira sólo ve su agenda, por su cita: un id de otra clínica o de otra
 * consulta es un null, no un archivo ajeno.
 */
export async function chargeFileSignedUrl(
  tenantId: string,
  fileId: string,
  opts: { viewerProfessionalId?: string | null } = {},
): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return null;
  const where = [eq(patientChargeFiles.tenantId, tenantId), eq(patientChargeFiles.id, fileId)];
  if (opts.viewerProfessionalId) {
    where.push(eq(agendaAppointments.professionalId, opts.viewerProfessionalId));
  }
  const rows = await db
    .select({ key: patientChargeFiles.storageKey })
    .from(patientChargeFiles)
    .innerJoin(patientCharges, eq(patientCharges.id, patientChargeFiles.chargeId))
    .leftJoin(agendaAppointments, eq(agendaAppointments.id, patientCharges.appointmentId))
    .where(and(...where))
    .limit(1);
  const key = rows[0]?.key;
  if (!key) return null;
  return mediaSignedUrl(key, { bucket: internalBucket(), expiresInSeconds: 60 * 10 });
}
