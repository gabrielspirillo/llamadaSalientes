'use server';

import { Buffer } from 'node:buffer';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { auditLogs, users, whatsappConnections } from '@/lib/db/schema';
import { encrypt } from '@/lib/crypto';
import { env } from '@/lib/env';
import { getCurrentTenant } from '@/lib/tenant';
import { auth } from '@clerk/nextjs/server';

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

function ok<T>(data: T): ActionResult<T> {
  return { success: true, data };
}
function fail<T>(error: string, fieldErrors?: Record<string, string[]>): ActionResult<T> {
  return { success: false, error, fieldErrors };
}

async function getInternalUserId(): Promise<string | null> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return null;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);
  return rows[0]?.id ?? null;
}

// ─── Cloud API ────────────────────────────────────────────────────────────────────

const cloudSchema = z.object({
  phoneNumberId: z.string().min(5).max(64),
  wabaId: z.string().min(5).max(64),
  accessToken: z.string().min(20),
  appSecret: z.string().min(8),
});

export async function connectCloud(input: unknown): Promise<ActionResult<{ status: string }>> {
  const parsed = cloudSchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos', parsed.error.flatten().fieldErrors);
  const { phoneNumberId, wabaId, accessToken, appSecret } = parsed.data;

  // Probe contra Graph API antes de persistir.
  const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION ?? 'v21.0';
  let probeRes: Response;
  try {
    probeRes = await fetch(
      `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(phoneNumberId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
  } catch (probeErr) {
    return fail(`No pude alcanzar Graph API: ${(probeErr as Error).message}`);
  }
  if (!probeRes.ok) {
    const body = await probeRes.text().catch(() => '');
    return fail(
      `Validación Graph API falló (HTTP ${probeRes.status}): ${body.slice(0, 200)}. Revisa phoneNumberId y accessToken.`,
    );
  }

  const { tenant } = await getCurrentTenant();
  const senderUserId = await getInternalUserId();

  // Upsert por (tenant_id, mode='CLOUD').
  await db
    .insert(whatsappConnections)
    .values({
      tenantId: tenant.id,
      mode: 'CLOUD',
      phoneId: phoneNumberId,
      wabaId,
      cloudAccessTokenEnc: encrypt(accessToken),
      cloudAppSecretEnc: encrypt(appSecret),
      status: 'CONNECTED',
    })
    .onConflictDoUpdate({
      target: [whatsappConnections.tenantId, whatsappConnections.mode],
      set: {
        phoneId: phoneNumberId,
        wabaId,
        cloudAccessTokenEnc: encrypt(accessToken),
        cloudAppSecretEnc: encrypt(appSecret),
        status: 'CONNECTED',
        qrB64: null,
        updatedAt: new Date(),
      },
    });

  try {
    await db.insert(auditLogs).values({
      tenantId: tenant.id,
      actorUserId: senderUserId,
      action: 'wa_cloud_connected',
      entity: 'whatsapp_connection',
      after: { phoneNumberId, wabaId } as never,
    });
  } catch (auditErr) {
    console.error('audit_failed', auditErr);
  }

  revalidatePath('/dashboard/whatsapp/integrations');
  return ok({ status: 'CONNECTED' });
}

// ─── Twilio ────────────────────────────────────────────────────────────────────

const e164Regex = /^\+[1-9]\d{6,14}$/;

const twilioSchema = z.object({
  accountSid: z.string().regex(/^AC[a-fA-F0-9]{32}$/, 'Account SID inválido (formato AC...32hex)'),
  authToken: z.string().min(20),
  fromNumber: z
    .string()
    .trim()
    .transform((s) => (s.startsWith('whatsapp:') ? s.slice('whatsapp:'.length) : s))
    .pipe(z.string().regex(e164Regex, 'Número remitente debe ser E.164 (ej: +34123456789)')),
});

export async function connectTwilio(input: unknown): Promise<ActionResult<{ status: string }>> {
  const parsed = twilioSchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos', parsed.error.flatten().fieldErrors);
  const { accountSid, authToken, fromNumber } = parsed.data;

  // Probe contra Twilio antes de persistir: GET /Accounts/{SID}.json valida
  // tanto el SID como el token con un solo round-trip.
  const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
  let probeRes: Response;
  try {
    probeRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`,
      { headers: { Authorization: authHeader } },
    );
  } catch (probeErr) {
    return fail(`No pude alcanzar Twilio: ${(probeErr as Error).message}`);
  }
  if (!probeRes.ok) {
    const body = await probeRes.text().catch(() => '');
    return fail(
      `Validación Twilio falló (HTTP ${probeRes.status}): ${body.slice(0, 200)}. Revisa Account SID y Auth Token.`,
    );
  }

  const { tenant } = await getCurrentTenant();
  const senderUserId = await getInternalUserId();

  await db
    .insert(whatsappConnections)
    .values({
      tenantId: tenant.id,
      mode: 'TWILIO',
      twilioAccountSid: accountSid,
      twilioAuthTokenEnc: encrypt(authToken),
      twilioFromNumber: fromNumber,
      status: 'CONNECTED',
    })
    .onConflictDoUpdate({
      target: [whatsappConnections.tenantId, whatsappConnections.mode],
      set: {
        twilioAccountSid: accountSid,
        twilioAuthTokenEnc: encrypt(authToken),
        twilioFromNumber: fromNumber,
        status: 'CONNECTED',
        qrB64: null,
        updatedAt: new Date(),
      },
    });

  try {
    await db.insert(auditLogs).values({
      tenantId: tenant.id,
      actorUserId: senderUserId,
      action: 'wa_twilio_connected',
      entity: 'whatsapp_connection',
      after: { accountSid, fromNumber } as never,
    });
  } catch (auditErr) {
    console.error('audit_failed', auditErr);
  }

  revalidatePath('/dashboard/whatsapp/integrations');
  return ok({ status: 'CONNECTED' });
}

// ─── Evolution API ─────────────────────────────────────────────────────────────

interface EvolutionInstanceCreateResponse {
  hash?: { apikey?: string } | string;
  qrcode?: { base64?: string; code?: string };
  instance?: { instanceName?: string; status?: string };
}

export async function connectEvolution(): Promise<
  ActionResult<{ qrBase64: string | null; instanceName: string }>
> {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const adminApiKey = process.env.EVOLUTION_API_KEY;
  if (!baseUrl) return fail('EVOLUTION_API_URL no configurado en este entorno');
  if (!adminApiKey) return fail('EVOLUTION_API_KEY no configurado (necesario para crear instancia)');

  const { tenant } = await getCurrentTenant();
  const senderUserId = await getInternalUserId();
  const instanceName = `tenant-${tenant.slug}`;
  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  const webhookUrl = `${appUrl}/api/webhooks/whatsapp/evolution`;

  let createRes: Response;
  try {
    createRes = await fetch(`${baseUrl.replace(/\/$/, '')}/instance/create`, {
      method: 'POST',
      headers: { apikey: adminApiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' }),
    });
  } catch (probeErr) {
    return fail(`No pude alcanzar Evolution: ${(probeErr as Error).message}`);
  }

  if (!createRes.ok) {
    const body = await createRes.text().catch(() => '');
    return fail(
      `Evolution /instance/create falló (HTTP ${createRes.status}): ${body.slice(0, 200)}`,
    );
  }
  const created = (await createRes.json()) as EvolutionInstanceCreateResponse;
  const instanceHash = typeof created.hash === 'string' ? created.hash : created.hash?.apikey;
  if (!instanceHash) return fail('Evolution no devolvió hash/apikey de la instancia');
  const qrBase64 = created.qrcode?.base64 ?? null;

  await db
    .insert(whatsappConnections)
    .values({
      tenantId: tenant.id,
      mode: 'EVOLUTION',
      evolutionInstance: instanceName,
      evolutionTokenEnc: encrypt(instanceHash),
      qrB64: qrBase64,
      status: 'PENDING',
    })
    .onConflictDoUpdate({
      target: [whatsappConnections.tenantId, whatsappConnections.mode],
      set: {
        evolutionInstance: instanceName,
        evolutionTokenEnc: encrypt(instanceHash),
        qrB64: qrBase64,
        status: 'PENDING',
        updatedAt: new Date(),
      },
    });

  // Configurar webhook por instancia (best effort).
  try {
    await fetch(`${baseUrl.replace(/\/$/, '')}/webhook/set/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      headers: { apikey: instanceHash, 'content-type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        webhook_by_events: false,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
      }),
    });
  } catch (whErr) {
    console.warn('[connectEvolution] webhook/set falló:', (whErr as Error).message);
  }

  try {
    await db.insert(auditLogs).values({
      tenantId: tenant.id,
      actorUserId: senderUserId,
      action: 'wa_evolution_instance_created',
      entity: 'whatsapp_connection',
      after: { instanceName, hasQr: !!qrBase64 } as never,
    });
  } catch (auditErr) {
    console.error('audit_failed', auditErr);
  }

  revalidatePath('/dashboard/whatsapp/integrations');
  return ok({ qrBase64, instanceName });
}

// ─── Status + disconnect ─────────────────────────────────────────────────────

export interface ConnectionSnapshot {
  cloud: {
    status: string;
    phoneId: string | null;
    wabaId: string | null;
  } | null;
  evolution: {
    status: string;
    instanceName: string | null;
    qrBase64: string | null;
  } | null;
  twilio: {
    status: string;
    accountSid: string | null;
    fromNumber: string | null;
  } | null;
}

export async function getConnectionStatus(): Promise<ActionResult<ConnectionSnapshot>> {
  const { tenant } = await getCurrentTenant();
  const rows = await db
    .select()
    .from(whatsappConnections)
    .where(eq(whatsappConnections.tenantId, tenant.id));
  const cloud = rows.find((r) => r.mode === 'CLOUD');
  const evolution = rows.find((r) => r.mode === 'EVOLUTION');
  const twilio = rows.find((r) => r.mode === 'TWILIO');
  return ok({
    cloud: cloud ? { status: cloud.status, phoneId: cloud.phoneId, wabaId: cloud.wabaId } : null,
    evolution: evolution
      ? {
          status: evolution.status,
          instanceName: evolution.evolutionInstance,
          qrBase64: evolution.qrB64,
        }
      : null,
    twilio: twilio
      ? {
          status: twilio.status,
          accountSid: twilio.twilioAccountSid,
          fromNumber: twilio.twilioFromNumber,
        }
      : null,
  });
}

const disconnectSchema = z.object({ mode: z.enum(['CLOUD', 'EVOLUTION', 'TWILIO']) });

export async function disconnect(input: unknown): Promise<ActionResult<null>> {
  const parsed = disconnectSchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos', parsed.error.flatten().fieldErrors);
  const { tenant } = await getCurrentTenant();
  const senderUserId = await getInternalUserId();

  await db
    .update(whatsappConnections)
    .set({
      status: 'DISCONNECTED',
      cloudAccessTokenEnc: parsed.data.mode === 'CLOUD' ? null : undefined,
      cloudAppSecretEnc: parsed.data.mode === 'CLOUD' ? null : undefined,
      evolutionTokenEnc: parsed.data.mode === 'EVOLUTION' ? null : undefined,
      twilioAuthTokenEnc: parsed.data.mode === 'TWILIO' ? null : undefined,
      qrB64: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsappConnections.tenantId, tenant.id),
        eq(whatsappConnections.mode, parsed.data.mode),
      ),
    );

  try {
    await db.insert(auditLogs).values({
      tenantId: tenant.id,
      actorUserId: senderUserId,
      action: 'wa_disconnected',
      entity: 'whatsapp_connection',
      after: { mode: parsed.data.mode } as never,
    });
  } catch (auditErr) {
    console.error('audit_failed', auditErr);
  }

  revalidatePath('/dashboard/whatsapp/integrations');
  return ok(null);
}
