import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { renderAttendancePdf } from '@/lib/agenda/attendance-pdf';
import { getClinicSettings, getTenant } from '@/lib/data/clinic';
import { db } from '@/lib/db/client';
import {
  agendaAppointments,
  professionals,
  whatsappConversations,
  whatsappMessages,
} from '@/lib/db/schema';
import { env } from '@/lib/env';
import { getInvoiceSettings } from '@/lib/invoices/service';
import { getPatientPerson } from '@/lib/patients/persons';
import { getConnectorForTenant } from '@/lib/whatsapp/factory';
import { getOrCreateOpenConversation, upsertWhatsappContact } from '@/lib/whatsapp/persist';
import { parseWhatsappPhone } from '@/lib/whatsapp/phone';
import { publishMessageEvent } from '@/lib/whatsapp/realtime/publisher';
import type { WhatsAppConnector } from '@/lib/whatsapp/types';

/**
 * Justificante de asistencia de una cita: se genera al pedirlo (como la
 * factura), se descarga desde la hoja de la cita y se manda por el WhatsApp
 * de la clínica. No se guarda nada: la cita ya tiene todo lo que dice.
 */

export class AttendanceError extends Error {}

// ─── Enlace público firmado (mismo esquema que el de las facturas) ──────────

function keyMaterial(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY no está configurada');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY decodificada debe ser 32 bytes');
  return key;
}

function sign(tenantId: string, appointmentId: string, exp: number): string {
  return createHmac('sha256', keyMaterial())
    .update(`attendance-pdf:v1:${tenantId}:${appointmentId}:${exp}`)
    .digest('base64url')
    .slice(0, 43);
}

export function verifyAttendanceLink(
  tenantId: string,
  appointmentId: string,
  exp: number,
  signature: string | null | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!signature || !Number.isInteger(exp) || exp < nowSec) return false;
  const expected = Buffer.from(sign(tenantId, appointmentId, exp));
  const got = Buffer.from(signature);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function attendancePublicPath(tenantId: string, appointmentId: string, ttlSeconds: number) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/api/public/justificantes/${appointmentId}?t=${tenantId}&exp=${exp}&sig=${sign(tenantId, appointmentId, exp)}`;
}

// ─── Generar ────────────────────────────────────────────────────────────────

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function attendanceFileName(patientName: string, dateKey: string): string {
  return `Justificante-${slug(patientName) || 'paciente'}-${dateKey}.pdf`;
}

type LogoBytes = { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' };
const logoCache = new Map<string, { at: number; logo: LogoBytes | null }>();

async function fetchLogo(url: string | null): Promise<LogoBytes | null> {
  if (!url) return null;
  const cached = logoCache.get(url);
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.logo;
  let logo: LogoBytes | null = null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength <= 4 * 1024 * 1024) {
        if (bytes[0] === 0x89 && bytes[1] === 0x50) logo = { bytes, mime: 'image/png' };
        else if (bytes[0] === 0xff && bytes[1] === 0xd8) logo = { bytes, mime: 'image/jpeg' };
      }
    }
  } catch {
    logo = null;
  }
  logoCache.set(url, { at: Date.now(), logo });
  return logo;
}

export interface AttendancePdf {
  bytes: Uint8Array;
  fileName: string;
  patientName: string;
  patientPhone: string | null;
  patientKey: string;
  guardianName: string | null;
  dateLong: string;
}

export async function getAttendancePdf(
  tenantId: string,
  appointmentId: string,
): Promise<AttendancePdf | null> {
  const [row] = await db
    .select({
      a: agendaAppointments,
      professionalName: professionals.fullName,
    })
    .from(agendaAppointments)
    .innerJoin(professionals, eq(professionals.id, agendaAppointments.professionalId))
    .where(and(eq(agendaAppointments.tenantId, tenantId), eq(agendaAppointments.id, appointmentId)))
    .limit(1);
  if (!row) return null;
  const appt = row.a;
  if (appt.status === 'CANCELLED' || appt.status === 'NO_SHOW') {
    throw new AttendanceError('No se justifica una cita cancelada o a la que no vino.');
  }

  const [tenant, clinic, invoiceSettings, person] = await Promise.all([
    getTenant(tenantId),
    getClinicSettings(tenantId),
    getInvoiceSettings(tenantId),
    appt.patientId ? getPatientPerson(tenantId, appt.patientId) : Promise.resolve(null),
  ]);
  const tz = clinic?.timezone ?? 'Europe/Madrid';
  const clinicName = invoiceSettings?.issuerName?.trim() || tenant?.name?.trim() || 'la clínica';
  const guardian =
    person?.guardians.find((g) => g.primary && g.name) ?? person?.guardians.find((g) => g.name);
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    d.toLocaleString('es-ES', { ...opts, timeZone: tz });
  const dateLong = fmt(appt.startsAt, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const dateKey = fmt(appt.startsAt, { year: 'numeric', month: '2-digit', day: '2-digit' })
    .split('/')
    .reverse()
    .join('-');
  const bytes = await renderAttendancePdf({
    clinic: {
      name: clinicName,
      address: invoiceSettings?.address ?? clinic?.address ?? null,
      taxId: invoiceSettings?.taxId ?? null,
      phone: invoiceSettings?.phone ?? clinic?.phones?.[0] ?? null,
    },
    professionalName: row.professionalName,
    patientName: person?.fullName ?? appt.patientName,
    guardianName: guardian?.name ?? null,
    dateLong,
    startTime: fmt(appt.startsAt, { hour: '2-digit', minute: '2-digit', hour12: false }),
    endTime: fmt(appt.endsAt, { hour: '2-digit', minute: '2-digit', hour12: false }),
    issuedOn: fmt(new Date(), { day: 'numeric', month: 'long', year: 'numeric' }),
    logo: await fetchLogo(invoiceSettings?.logoUrl ?? tenant?.logoUrl ?? null),
  });
  return {
    bytes,
    fileName: attendanceFileName(person?.fullName ?? appt.patientName, dateKey),
    patientName: person?.fullName ?? appt.patientName,
    patientPhone: guardian?.phone ?? appt.patientPhone ?? null,
    patientKey: appt.patientKey,
    guardianName: guardian?.name ?? null,
    dateLong,
  };
}

export async function getAttendancePdfPublic(
  tenantId: string,
  appointmentId: string,
  exp: number,
  sig: string | null,
): Promise<AttendancePdf | null> {
  if (!verifyAttendanceLink(tenantId, appointmentId, exp, sig)) return null;
  return getAttendancePdf(tenantId, appointmentId);
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

export async function sendAttendanceWhatsapp(
  tenantId: string,
  appointmentId: string,
  phoneRaw?: string | null,
): Promise<{ patientKey: string; phone: string }> {
  const pdf = await getAttendancePdf(tenantId, appointmentId);
  if (!pdf) throw new AttendanceError('Esa cita no existe.');
  const phone = parseWhatsappPhone(phoneRaw || pdf.patientPhone || '');
  if (!phone.ok) throw new AttendanceError('La cita no tiene un teléfono válido al que enviarlo.');

  const connector = await getConnectorForTenant(tenantId).catch(() => null);
  if (!connector) {
    throw new AttendanceError(
      'La clínica no tiene WhatsApp conectado. Descarga el PDF y mándalo a mano.',
    );
  }
  const tenant = await getTenant(tenantId);
  const appUrl = (env.NEXT_PUBLIC_APP_URL || 'https://app.futuradigital.es').replace(/\/$/, '');
  const url = `${appUrl}${attendancePublicPath(tenantId, appointmentId, 60 * 60 * 72)}`;
  const text = `Hola${pdf.guardianName ? ` ${pdf.guardianName.split(/\s+/)[0]}` : ''}, te adjuntamos el justificante de asistencia de ${pdf.patientName} del ${pdf.dateLong}. Un saludo, ${tenant?.name?.trim() || 'la clínica'}.`;

  const contact = await upsertWhatsappContact({
    tenantId,
    phoneE164: phone.e164,
    name: pdf.guardianName ?? pdf.patientName,
  });
  const conversation = await getOrCreateOpenConversation({
    tenantId,
    contactId: contact.id,
    channel: channelOf(connector),
  });
  const sent = await connector.sendMedia(phone.e164, 'document', url, {
    caption: text,
    filename: pdf.fileName,
    mimeType: 'application/pdf',
  });
  const [inserted] = await db
    .insert(whatsappMessages)
    .values({
      tenantId,
      conversationId: conversation.id,
      externalId: sent.id,
      direction: 'OUTBOUND',
      type: 'PDF',
      senderType: 'HUMAN',
      contentText: text,
      mediaUrl: `/api/agenda/citas/${appointmentId}/justificante`,
      mediaType: 'application/pdf',
      rawJson: { channel: channelOf(connector), kind: 'attendance', appointmentId } as never,
    })
    .onConflictDoNothing({ target: [whatsappMessages.conversationId, whatsappMessages.externalId] })
    .returning();
  await db
    .update(whatsappConversations)
    .set({ lastMsgAt: new Date(), updatedAt: new Date() })
    .where(eq(whatsappConversations.id, conversation.id));
  if (inserted) await publishMessageEvent(inserted).catch(() => undefined);
  return { patientKey: pdf.patientKey, phone: phone.e164 };
}
