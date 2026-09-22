import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { getClinicTimezone } from '@/lib/agenda/queries';
import {
  type DocumensoConfig,
  DocumensoError,
  createDocument,
  distributeDocument,
  downloadSignedPdf,
  getSigningUrl,
  testConnection,
} from '@/lib/consents/documenso';
import { renderConsentPdf } from '@/lib/consents/pdf';
import {
  type ConsentTemplate,
  formatDateKeyEs,
  parseAcknowledgments,
  parseConsentBody,
  renderConsentMessage,
} from '@/lib/consents/template';
import { decrypt, encrypt } from '@/lib/crypto';
import { getTenant } from '@/lib/data/clinic';
import { db } from '@/lib/db/client';
import { consentTemplates, esignIntegrations, patientConsents } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { getPatientPerson } from '@/lib/patients/persons';
import { mediaSignedUrl, mediaUpload } from '@/lib/storage/media';
import { localDateKey } from '@/lib/tasks/tz';
import { getConnectorForTenant } from '@/lib/whatsapp/factory';
import { sendAgentResponse } from '@/lib/whatsapp/outbound/send-response';
import { getOrCreateOpenConversation, upsertWhatsappContact } from '@/lib/whatsapp/persist';
import { parseWhatsappPhone } from '@/lib/whatsapp/phone';
import type { WhatsAppConnector } from '@/lib/whatsapp/types';

/**
 * Consentimiento informado con firma digital, con un clic desde la ficha.
 *
 * El flujo entero: se tipografía el PDF con los datos del niño y del tutor ya
 * rellenos, se crea el documento en la instancia de Documenso de la clínica
 * (con el tutor como único firmante), se colocan la firma y la fecha donde el
 * PDF las dejó, se pasa a "pendiente" SIN correo, y el enlace de firma sale
 * por el WhatsApp de la clínica. Cuando Documenso avisa por webhook de que
 * está firmado, el PDF sellado se guarda en el bucket interno.
 *
 * Sólo las clínicas con `esign_integrations` y plantilla lo tienen. No hay
 * interruptor: es la presencia de esas dos filas.
 */

export class ConsentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConsentError';
  }
}

export const CONSENT_TEMPLATE_KEY = 'CONSENTIMIENTO_MENOR';

// ─── Integración ─────────────────────────────────────────────────────────────

export interface EsignIntegration {
  tenantId: string;
  baseUrl: string;
  apiToken: string;
  webhookSecret: string;
  active: boolean;
}

export async function getEsignIntegration(tenantId: string): Promise<EsignIntegration | null> {
  const rows = await db
    .select()
    .from(esignIntegrations)
    .where(eq(esignIntegrations.tenantId, tenantId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    tenantId: row.tenantId,
    baseUrl: row.baseUrl,
    apiToken: decrypt(row.apiTokenEnc),
    webhookSecret: decrypt(row.webhookSecretEnc),
    active: row.active,
  };
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+$/i.test(trimmed)) {
    throw new ConsentError(
      'La URL tiene que ser la raíz de Documenso, tipo https://consentimiento.respinens.es',
    );
  }
  return trimmed;
}

/**
 * Guarda (o reemplaza) la instancia de Documenso de la clínica. Antes de
 * guardar se prueba el token: un token mal copiado se descubre ahora y no
 * cuando recepción pulse "Enviar consentimiento".
 */
export async function upsertEsignIntegration(input: {
  tenantId: string;
  baseUrl: string;
  apiToken: string;
  webhookSecret: string;
}): Promise<void> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const apiToken = input.apiToken.trim();
  const webhookSecret = input.webhookSecret.trim();
  if (apiToken.length < 10) throw new ConsentError('El token de API no parece válido.');
  if (webhookSecret.length < 16)
    throw new ConsentError('El secreto del webhook es demasiado corto.');

  try {
    await testConnection({ baseUrl, apiToken });
  } catch (err) {
    throw new ConsentError(
      err instanceof DocumensoError
        ? err.status === 401 || err.status === 403
          ? 'Documenso rechazó el token. Revísalo en Ajustes → API Tokens.'
          : err.message
        : 'No se pudo comprobar la conexión con Documenso.',
    );
  }

  await db
    .insert(esignIntegrations)
    .values({
      tenantId: input.tenantId,
      provider: 'DOCUMENSO',
      baseUrl,
      apiTokenEnc: encrypt(apiToken),
      webhookSecretEnc: encrypt(webhookSecret),
      active: true,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: esignIntegrations.tenantId,
      set: {
        baseUrl,
        apiTokenEnc: encrypt(apiToken),
        webhookSecretEnc: encrypt(webhookSecret),
        active: true,
        updatedAt: new Date(),
      },
    });
}

// ─── Plantilla ───────────────────────────────────────────────────────────────

export async function getConsentTemplate(
  tenantId: string,
  key: string = CONSENT_TEMPLATE_KEY,
): Promise<ConsentTemplate | null> {
  const rows = await db
    .select()
    .from(consentTemplates)
    .where(
      and(
        eq(consentTemplates.tenantId, tenantId),
        eq(consentTemplates.key, key),
        eq(consentTemplates.active, true),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const body = parseConsentBody(row.body);
  if (!body) {
    // Una plantilla rota no puede mandar un PDF a medias: mejor que no exista.
    console.warn('[consents] plantilla con cuerpo inválido', { tenantId, key });
    return null;
  }
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    body,
    acknowledgments: parseAcknowledgments(row.acknowledgments),
    messageTemplate: row.messageTemplate,
  };
}

/** ¿Esta clínica puede mandar consentimientos? Integración activa y plantilla. */
export async function tenantHasEsign(tenantId: string): Promise<boolean> {
  const [integration, template] = await Promise.all([
    getEsignIntegration(tenantId).catch(() => null),
    getConsentTemplate(tenantId).catch(() => null),
  ]);
  return Boolean(integration?.active && template);
}

// ─── Envíos ──────────────────────────────────────────────────────────────────

export type ConsentRow = typeof patientConsents.$inferSelect;

export async function listPatientConsents(
  tenantId: string,
  patientId: string,
): Promise<ConsentRow[]> {
  return db
    .select()
    .from(patientConsents)
    .where(and(eq(patientConsents.tenantId, tenantId), eq(patientConsents.patientId, patientId)))
    .orderBy(desc(patientConsents.createdAt))
    .limit(50);
}

export const guardianInputSchema = z.object({
  name: z.string().trim().min(2, 'El nombre del tutor es obligatorio.').max(160),
  phone: z.string().trim().min(6, 'Falta el WhatsApp del tutor.').max(40),
  email: z.string().trim().max(160).optional().or(z.literal('')),
  dni: z.string().trim().max(24).optional().or(z.literal('')),
  address: z.string().trim().max(240).optional().or(z.literal('')),
  phone2: z.string().trim().max(40).optional().or(z.literal('')),
});
export type GuardianInput = z.infer<typeof guardianInputSchema>;

export interface SendConsentResult {
  consentId: string;
  signingUrl: string;
  whatsappSent: boolean;
  warning?: string;
}

/**
 * Documenso exige un correo por firmante y muchos tutores no lo tienen (o no
 * lo saben de memoria por teléfono). Como el enlace va por WhatsApp y los
 * correos están apagados, un correo técnico y único por teléfono basta.
 */
function placeholderEmail(phoneE164: string): string {
  return `tutor.${phoneE164.replace(/\D/g, '')}@sin-correo.invalid`;
}

function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName.trim();
}

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

function emptyToNull(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

export async function sendConsent(input: {
  tenantId: string;
  patientId: string;
  guardian: GuardianInput;
  sentByUserId: string | null;
  templateKey?: string;
  /** Se inyecta en los tests; en producción lo resuelve el tenant. */
  connector?: WhatsAppConnector | null;
}): Promise<SendConsentResult> {
  const guardian = guardianInputSchema.parse(input.guardian);
  const phone = parseWhatsappPhone(guardian.phone);
  if (!phone.ok) throw new ConsentError(phone.error);
  const email = emptyToNull(guardian.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ConsentError('El correo del tutor no es válido.');
  }

  const [integration, template, person, tenant, timezone] = await Promise.all([
    getEsignIntegration(input.tenantId),
    getConsentTemplate(input.tenantId, input.templateKey),
    getPatientPerson(input.tenantId, input.patientId),
    getTenant(input.tenantId),
    getClinicTimezone(input.tenantId),
  ]);
  if (!integration?.active) {
    throw new ConsentError('Esta clínica no tiene la firma digital configurada.');
  }
  if (!template) throw new ConsentError('Esta clínica no tiene plantilla de consentimiento.');
  if (!person) throw new ConsentError('Ese paciente no existe en esta clínica.');

  const clinicName = tenant?.name?.trim() || 'la clínica';
  const todayKey = localDateKey(new Date(), timezone);

  const rendered = await renderConsentPdf({
    title: template.title,
    body: template.body,
    acknowledgments: template.acknowledgments,
    parties: {
      clinicName,
      childName: person.fullName,
      childBirthDate: formatDateKeyEs(person.birthDate),
      guardianName: guardian.name,
      guardianDni: emptyToNull(guardian.dni),
      guardianAddress: emptyToNull(guardian.address),
      guardianPhone: phone.e164,
      guardianPhone2: emptyToNull(guardian.phone2),
      guardianEmail: email,
      issuedOn: formatDateKeyEs(todayKey) ?? todayKey,
    },
  });

  // Nuestro id va como externalId a Documenso: el webhook lo devuelve y así
  // no dependemos de que el id numérico de una instancia no choque con otra.
  const consentId = randomUUID();
  const cfg: DocumensoConfig = { baseUrl: integration.baseUrl, apiToken: integration.apiToken };

  let created: Awaited<ReturnType<typeof createDocument>>;
  let signingUrl: string;
  try {
    created = await createDocument(cfg, {
      title: `${template.title} — ${person.fullName}`,
      externalId: consentId,
      recipient: { name: guardian.name, email: email ?? placeholderEmail(phone.e164) },
      fields: rendered.fields.map((f) => ({
        type: f.type,
        pageNumber: f.pageNumber,
        pageX: f.pageX,
        pageY: f.pageY,
        width: f.pageWidth,
        height: f.pageHeight,
      })),
      timezone,
      pdf: rendered.bytes,
      filename: `consentimiento-${consentId}.pdf`,
    });
    signingUrl = await getSigningUrl(cfg, created.documentId);
    await distributeDocument(cfg, created.documentId);
  } catch (err) {
    throw new ConsentError(
      err instanceof DocumensoError
        ? err.message
        : `No se pudo crear el documento: ${(err as Error).message}`,
    );
  }

  const now = new Date();
  await db.insert(patientConsents).values({
    id: consentId,
    tenantId: input.tenantId,
    patientId: input.patientId,
    templateId: template.id,
    templateKey: template.key,
    provider: 'DOCUMENSO',
    providerDocumentId: created.documentId,
    recipientName: guardian.name,
    recipientEmail: email,
    recipientPhone: phone.e164,
    recipientDni: emptyToNull(guardian.dni),
    recipientAddress: emptyToNull(guardian.address),
    signingUrl: signingUrl,
    status: 'SENT',
    sentAt: now,
    sentByUserId: input.sentByUserId,
  });

  // El WhatsApp, por el número de la clínica y firmado como equipo. Si no
  // sale, el documento ya existe y el enlace se puede reenviar a mano: no se
  // tira nada.
  const connector =
    input.connector === undefined
      ? await getConnectorForTenant(input.tenantId).catch(() => null)
      : input.connector;
  if (!connector) {
    await db
      .update(patientConsents)
      .set({ error: 'Sin WhatsApp conectado', updatedAt: new Date() })
      .where(eq(patientConsents.id, consentId));
    return {
      consentId,
      signingUrl: signingUrl,
      whatsappSent: false,
      warning: 'La clínica no tiene WhatsApp conectado. Copia el enlace y mándaselo al tutor.',
    };
  }

  try {
    const contact = await upsertWhatsappContact({
      tenantId: input.tenantId,
      phoneE164: phone.e164,
      name: guardian.name,
    });
    const conversation = await getOrCreateOpenConversation({
      tenantId: input.tenantId,
      contactId: contact.id,
      channel: channelOf(connector),
    });
    const text = renderConsentMessage(template.messageTemplate, {
      tutor: firstNameOf(guardian.name),
      paciente: person.firstName,
      clinica: clinicName,
      enlace: signingUrl,
    });
    const sent = await sendAgentResponse({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      toPhoneE164: phone.e164,
      text,
      connector,
      senderType: 'HUMAN',
    });
    await db
      .update(patientConsents)
      .set({ whatsappMessageId: sent.externalId, error: null, updatedAt: new Date() })
      .where(eq(patientConsents.id, consentId));
    return { consentId, signingUrl: signingUrl, whatsappSent: true };
  } catch (err) {
    const message = (err as Error).message ?? 'error desconocido';
    console.error('[consents] el WhatsApp del consentimiento no salió', {
      tenantId: input.tenantId,
      consentId,
      err: message,
    });
    await db
      .update(patientConsents)
      .set({ error: `WhatsApp: ${message}`.slice(0, 500), updatedAt: new Date() })
      .where(eq(patientConsents.id, consentId));
    return {
      consentId,
      signingUrl: signingUrl,
      whatsappSent: false,
      warning: `El WhatsApp no salió (${message}). Copia el enlace y mándaselo al tutor.`,
    };
  }
}

// ─── Firmado ─────────────────────────────────────────────────────────────────

function internalBucket(): string {
  return env.S3_BUCKET_INTERNAL;
}

/**
 * Documenso avisó de que el tutor firmó: se baja el PDF sellado y se guarda
 * en el bucket interno. Idempotente: un segundo aviso por el mismo documento
 * no vuelve a bajar nada.
 */
export async function completeConsent(input: {
  tenantId: string;
  providerDocumentId: number | null;
  externalId: string | null;
  completedAt: Date;
}): Promise<{ consentId: string | null; already: boolean }> {
  const byExternal =
    input.externalId && /^[0-9a-f-]{36}$/i.test(input.externalId)
      ? await db
          .select()
          .from(patientConsents)
          .where(
            and(
              eq(patientConsents.tenantId, input.tenantId),
              eq(patientConsents.id, input.externalId),
            ),
          )
          .limit(1)
      : [];
  const byDocument =
    byExternal.length === 0 && input.providerDocumentId !== null
      ? await db
          .select()
          .from(patientConsents)
          .where(
            and(
              eq(patientConsents.tenantId, input.tenantId),
              eq(patientConsents.providerDocumentId, input.providerDocumentId),
            ),
          )
          .limit(1)
      : [];
  const row = byExternal[0] ?? byDocument[0];
  if (!row) return { consentId: null, already: false };
  if (row.status === 'SIGNED' && row.pdfKey) return { consentId: row.id, already: true };

  const integration = await getEsignIntegration(input.tenantId);
  if (!integration) throw new ConsentError('La clínica ya no tiene la firma digital configurada.');
  const documentId = row.providerDocumentId ?? input.providerDocumentId;
  if (documentId === null)
    throw new ConsentError('El consentimiento no tiene documento en Documenso.');

  const bytes = await downloadSignedPdf(
    { baseUrl: integration.baseUrl, apiToken: integration.apiToken },
    documentId,
  );
  const key = `tenants/${input.tenantId}/consents/${row.id}.pdf`;
  await mediaUpload({
    bucket: internalBucket(),
    path: key,
    body: Buffer.from(bytes),
    contentType: 'application/pdf',
  });

  await db
    .update(patientConsents)
    .set({
      status: 'SIGNED',
      signedAt: input.completedAt,
      pdfKey: key,
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(patientConsents.id, row.id));

  // Aviso en el chat interno, best-effort: que recepción se entere sin mirar.
  try {
    const [{ postConsentSigned }, person] = await Promise.all([
      import('@/lib/messaging/bot'),
      getPatientPerson(input.tenantId, row.patientId),
    ]);
    await postConsentSigned({
      tenantId: input.tenantId,
      consentId: row.id,
      patientId: row.patientId,
      patientName: person?.fullName ?? 'paciente',
      guardianName: row.recipientName,
    });
  } catch (err) {
    console.warn('[consents] no se pudo avisar en el chat interno', (err as Error).message);
  }

  return { consentId: row.id, already: false };
}

/** URL firmada y efímera del PDF firmado, o null si no existe o no está firmado. */
export async function consentPdfSignedUrl(
  tenantId: string,
  consentId: string,
): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(consentId)) return null;
  const rows = await db
    .select({ pdfKey: patientConsents.pdfKey })
    .from(patientConsents)
    .where(and(eq(patientConsents.tenantId, tenantId), eq(patientConsents.id, consentId)))
    .limit(1);
  const key = rows[0]?.pdfKey;
  if (!key) return null;
  return mediaSignedUrl(key, { bucket: internalBucket(), expiresInSeconds: 60 * 10 });
}
