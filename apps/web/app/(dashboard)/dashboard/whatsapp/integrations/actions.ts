'use server';

import { Buffer } from 'node:buffer';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { auditLogs, users, whatsappConnections } from '@/lib/db/schema';
import { decrypt, encrypt } from '@/lib/crypto';
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

  revalidatePath('/dashboard/configuration');
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

  revalidatePath('/dashboard/configuration');
  return ok({ status: 'CONNECTED' });
}

// ─── Evolution API ─────────────────────────────────────────────────────────────

interface EvolutionInstanceCreateResponse {
  hash?: { apikey?: string } | string;
  qrcode?: { base64?: string; code?: string; pairingCode?: string };
  instance?: { instanceName?: string; status?: string; state?: string };
}

const EVOLUTION_WEBHOOK_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
  'SEND_MESSAGE',
] as const;

function evolutionBase(): { baseUrl: string; adminApiKey: string } | { error: string } {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const adminApiKey = process.env.EVOLUTION_API_KEY;
  if (!baseUrl) return { error: 'EVOLUTION_API_URL no configurado en este entorno' };
  if (!adminApiKey) {
    return { error: 'EVOLUTION_API_KEY no configurado (necesario para crear instancia)' };
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), adminApiKey };
}

function evolutionInstanceName(slug: string): string {
  // Evolution v2 acepta letras/números/guion. Slugs ya están sanitizados.
  return `tenant-${slug}`;
}

function evolutionWebhookUrl(): string {
  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  return `${appUrl}/api/webhooks/whatsapp/evolution`;
}

async function setEvolutionWebhook(
  baseUrl: string,
  instanceName: string,
  apiKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // v2 flat body (camelCase). Ver
  // https://doc.evolution-api.com/v2/api-reference/webhook/set
  try {
    const res = await fetch(
      `${baseUrl}/webhook/set/${encodeURIComponent(instanceName)}`,
      {
        method: 'POST',
        headers: { apikey: apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          url: evolutionWebhookUrl(),
          webhookByEvents: false,
          webhookBase64: false,
          events: [...EVOLUTION_WEBHOOK_EVENTS],
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function connectEvolution(): Promise<
  ActionResult<{ qrBase64: string | null; pairingCode: string | null; instanceName: string }>
> {
  const cfg = evolutionBase();
  if ('error' in cfg) return fail(cfg.error);

  const { tenant } = await getCurrentTenant();
  const senderUserId = await getInternalUserId();
  const instanceName = evolutionInstanceName(tenant.slug);

  // v2 admite anidar la config del webhook en /instance/create. Lo hacemos
  // para que la creación + alta de webhook sea atómica. Si Evolution
  // (alguna versión) ignora el campo `webhook`, hacemos un /webhook/set
  // best-effort después.
  let createRes: Response;
  try {
    createRes = await fetch(`${cfg.baseUrl}/instance/create`, {
      method: 'POST',
      headers: { apikey: cfg.adminApiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        rejectCall: false,
        groupsIgnore: true,
        alwaysOnline: false,
        readMessages: false,
        readStatus: false,
        webhook: {
          url: evolutionWebhookUrl(),
          byEvents: false,
          base64: false,
          events: [...EVOLUTION_WEBHOOK_EVENTS],
        },
      }),
    });
  } catch (probeErr) {
    return fail(`No pude alcanzar Evolution: ${(probeErr as Error).message}`);
  }

  // Evolution v2 devuelve 403 con "instance already exists" cuando ya existe.
  // En ese caso, fetch del hash via el DB local + pedimos QR nuevo via /connect.
  if (createRes.status === 403) {
    const existing = await db
      .select()
      .from(whatsappConnections)
      .where(
        and(
          eq(whatsappConnections.tenantId, tenant.id),
          eq(whatsappConnections.mode, 'EVOLUTION'),
        ),
      )
      .limit(1);
    const conn = existing[0];
    if (conn?.evolutionTokenEnc && conn.evolutionInstance) {
      const refreshed = await refreshEvolutionQrInternal({
        baseUrl: cfg.baseUrl,
        instanceName: conn.evolutionInstance,
        apiKey: decrypt(conn.evolutionTokenEnc),
      });
      if (refreshed.ok) {
        await db
          .update(whatsappConnections)
          .set({
            qrB64: refreshed.qrBase64,
            status: 'PENDING',
            updatedAt: new Date(),
          })
          .where(eq(whatsappConnections.id, conn.id));
        revalidatePath('/dashboard/configuration');
        return ok({
          qrBase64: refreshed.qrBase64,
          pairingCode: refreshed.pairingCode,
          instanceName: conn.evolutionInstance,
        });
      }
    }
    const body = await createRes.text().catch(() => '');
    return fail(
      `Evolution /instance/create devolvió 403 y no hay credenciales locales para recuperar: ${body.slice(0, 200)}`,
    );
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
  const pairingCode = created.qrcode?.pairingCode ?? created.qrcode?.code ?? null;

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

  // Reaseguramos el webhook con /webhook/set (algunas versiones ignoran el
  // campo nested al crear). El hash de la instancia ya autoriza este endpoint.
  const whResult = await setEvolutionWebhook(cfg.baseUrl, instanceName, instanceHash);
  if (!whResult.ok) {
    console.warn('[connectEvolution] /webhook/set falló:', whResult.error);
  }

  try {
    await db.insert(auditLogs).values({
      tenantId: tenant.id,
      actorUserId: senderUserId,
      action: 'wa_evolution_instance_created',
      entity: 'whatsapp_connection',
      after: { instanceName, hasQr: !!qrBase64, hasPairing: !!pairingCode } as never,
    });
  } catch (auditErr) {
    console.error('audit_failed', auditErr);
  }

  revalidatePath('/dashboard/configuration');
  return ok({ qrBase64, pairingCode, instanceName });
}

// ─── Refresh QR + Status polling ────────────────────────────────────────────

async function refreshEvolutionQrInternal(params: {
  baseUrl: string;
  instanceName: string;
  apiKey: string;
}): Promise<
  { ok: true; qrBase64: string | null; pairingCode: string | null; state: string }
  | { ok: false; error: string }
> {
  try {
    const res = await fetch(
      `${params.baseUrl}/instance/connect/${encodeURIComponent(params.instanceName)}`,
      { method: 'GET', headers: { apikey: params.apiKey } },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = (await res.json()) as {
      base64?: string | null;
      code?: string | null;
      pairingCode?: string | null;
      instance?: { state?: string };
    };
    // /instance/connect devuelve `base64` (imagen), `code` (string Baileys
    // serializado del QR) y opcionalmente `pairingCode` (8 dígitos).
    return {
      ok: true,
      qrBase64: json.base64 ?? null,
      pairingCode: json.pairingCode ?? null,
      state: json.instance?.state ?? 'connecting',
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function refreshEvolutionQr(): Promise<
  ActionResult<{ qrBase64: string | null; pairingCode: string | null; state: string }>
> {
  const cfg = evolutionBase();
  if ('error' in cfg) return fail(cfg.error);
  const { tenant } = await getCurrentTenant();
  const rows = await db
    .select()
    .from(whatsappConnections)
    .where(
      and(eq(whatsappConnections.tenantId, tenant.id), eq(whatsappConnections.mode, 'EVOLUTION')),
    )
    .limit(1);
  const conn = rows[0];
  if (!conn?.evolutionInstance || !conn.evolutionTokenEnc) {
    return fail('No hay instancia Evolution creada para este tenant');
  }
  const r = await refreshEvolutionQrInternal({
    baseUrl: cfg.baseUrl,
    instanceName: conn.evolutionInstance,
    apiKey: decrypt(conn.evolutionTokenEnc),
  });
  if (!r.ok) return fail(`No pude pedir QR: ${r.error}`);
  await db
    .update(whatsappConnections)
    .set({
      qrB64: r.qrBase64,
      status: r.state === 'open' ? 'CONNECTED' : 'PENDING',
      updatedAt: new Date(),
    })
    .where(eq(whatsappConnections.id, conn.id));
  revalidatePath('/dashboard/configuration');
  return ok({ qrBase64: r.qrBase64, pairingCode: r.pairingCode, state: r.state });
}

export async function getEvolutionConnectionState(): Promise<
  ActionResult<{ state: string; status: string }>
> {
  const cfg = evolutionBase();
  if ('error' in cfg) return fail(cfg.error);
  const { tenant } = await getCurrentTenant();
  const rows = await db
    .select()
    .from(whatsappConnections)
    .where(
      and(eq(whatsappConnections.tenantId, tenant.id), eq(whatsappConnections.mode, 'EVOLUTION')),
    )
    .limit(1);
  const conn = rows[0];
  if (!conn?.evolutionInstance || !conn.evolutionTokenEnc) {
    return fail('No hay instancia Evolution creada para este tenant');
  }
  try {
    const res = await fetch(
      `${cfg.baseUrl}/instance/connectionState/${encodeURIComponent(conn.evolutionInstance)}`,
      { method: 'GET', headers: { apikey: decrypt(conn.evolutionTokenEnc) } },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return fail(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { instance?: { state?: string }; state?: string };
    const state = json.instance?.state ?? json.state ?? 'close';
    const status =
      state === 'open'
        ? 'CONNECTED'
        : state === 'connecting' || state === 'qrcode'
          ? 'PENDING'
          : state === 'close'
            ? 'DISCONNECTED'
            : 'ERROR';
    await db
      .update(whatsappConnections)
      .set({
        status: status as 'CONNECTED' | 'PENDING' | 'DISCONNECTED' | 'ERROR',
        qrB64: status === 'CONNECTED' ? null : conn.qrB64,
        updatedAt: new Date(),
      })
      .where(eq(whatsappConnections.id, conn.id));
    if (status !== conn.status) {
      revalidatePath('/dashboard/configuration');
    }
    return ok({ state, status });
  } catch (err) {
    return fail(`No pude consultar estado: ${(err as Error).message}`);
  }
}

// ─── Chatwoot bridge (opcional) ──────────────────────────────────────────────

const chatwootSchema = z.object({
  url: z.string().url('URL Chatwoot inválida'),
  accountId: z.string().min(1, 'Account ID requerido'),
  token: z.string().min(20, 'API token Chatwoot demasiado corto'),
  nameInbox: z.string().trim().min(1).max(64).optional(),
  signMsg: z.boolean().optional(),
  reopenConversation: z.boolean().optional(),
  importContacts: z.boolean().optional(),
  importMessages: z.boolean().optional(),
});

/**
 * Conecta la instancia Evolution con un inbox Chatwoot. Cuando está activo,
 * Evolution actúa como bridge: cada inbound de WhatsApp se reenvía a Chatwoot
 * (y los agentes responden desde Chatwoot). Nuestro webhook MESSAGES_UPSERT
 * sigue llegando en paralelo, así el inbox propio sigue funcionando.
 *
 * Útil cuando el equipo prefiere atender desde Chatwoot. Para desactivar,
 * llamar a `disconnectChatwoot()`.
 */
export async function setChatwoot(input: unknown): Promise<ActionResult<null>> {
  const parsed = chatwootSchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos', parsed.error.flatten().fieldErrors);
  const cfg = evolutionBase();
  if ('error' in cfg) return fail(cfg.error);
  const { tenant } = await getCurrentTenant();
  const senderUserId = await getInternalUserId();
  const rows = await db
    .select()
    .from(whatsappConnections)
    .where(
      and(eq(whatsappConnections.tenantId, tenant.id), eq(whatsappConnections.mode, 'EVOLUTION')),
    )
    .limit(1);
  const conn = rows[0];
  if (!conn?.evolutionInstance || !conn.evolutionTokenEnc) {
    return fail('Crea primero la instancia Evolution');
  }
  try {
    const res = await fetch(
      `${cfg.baseUrl}/chatwoot/set/${encodeURIComponent(conn.evolutionInstance)}`,
      {
        method: 'POST',
        headers: {
          apikey: decrypt(conn.evolutionTokenEnc),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          enabled: true,
          accountId: parsed.data.accountId,
          token: parsed.data.token,
          url: parsed.data.url.replace(/\/$/, ''),
          signMsg: parsed.data.signMsg ?? false,
          reopenConversation: parsed.data.reopenConversation ?? true,
          conversationPending: false,
          nameInbox: parsed.data.nameInbox ?? `cliniq-${tenant.slug}`,
          importContacts: parsed.data.importContacts ?? false,
          importMessages: parsed.data.importMessages ?? false,
          mergeBrazilContacts: false,
          daysLimitImportMessages: 7,
          organization: 'Cliniq',
          logo: '',
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return fail(`Chatwoot bridge falló (HTTP ${res.status}): ${body.slice(0, 200)}`);
    }
  } catch (err) {
    return fail(`No pude conectar Chatwoot: ${(err as Error).message}`);
  }
  try {
    await db.insert(auditLogs).values({
      tenantId: tenant.id,
      actorUserId: senderUserId,
      action: 'wa_evolution_chatwoot_set',
      entity: 'whatsapp_connection',
      entityId: conn.id,
      after: { url: parsed.data.url, accountId: parsed.data.accountId } as never,
    });
  } catch (auditErr) {
    console.error('audit_failed', auditErr);
  }
  revalidatePath('/dashboard/configuration');
  return ok(null);
}

export async function disconnectChatwoot(): Promise<ActionResult<null>> {
  const cfg = evolutionBase();
  if ('error' in cfg) return fail(cfg.error);
  const { tenant } = await getCurrentTenant();
  const rows = await db
    .select()
    .from(whatsappConnections)
    .where(
      and(eq(whatsappConnections.tenantId, tenant.id), eq(whatsappConnections.mode, 'EVOLUTION')),
    )
    .limit(1);
  const conn = rows[0];
  if (!conn?.evolutionInstance || !conn.evolutionTokenEnc) {
    return fail('No hay instancia Evolution');
  }
  try {
    await fetch(`${cfg.baseUrl}/chatwoot/set/${encodeURIComponent(conn.evolutionInstance)}`, {
      method: 'POST',
      headers: {
        apikey: decrypt(conn.evolutionTokenEnc),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ enabled: false }),
    });
  } catch (err) {
    return fail(`No pude desconectar Chatwoot: ${(err as Error).message}`);
  }
  revalidatePath('/dashboard/configuration');
  return ok(null);
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

  // Para EVOLUTION, también cerramos la sesión en el server Evolution
  // (best-effort). Si falla, igualmente marcamos DISCONNECTED en BD.
  if (parsed.data.mode === 'EVOLUTION') {
    const cfg = evolutionBase();
    if (!('error' in cfg)) {
      const rows = await db
        .select()
        .from(whatsappConnections)
        .where(
          and(
            eq(whatsappConnections.tenantId, tenant.id),
            eq(whatsappConnections.mode, 'EVOLUTION'),
          ),
        )
        .limit(1);
      const conn = rows[0];
      if (conn?.evolutionInstance && conn.evolutionTokenEnc) {
        try {
          await fetch(
            `${cfg.baseUrl}/instance/logout/${encodeURIComponent(conn.evolutionInstance)}`,
            { method: 'DELETE', headers: { apikey: decrypt(conn.evolutionTokenEnc) } },
          );
        } catch (logoutErr) {
          console.warn('[disconnect] /instance/logout falló:', (logoutErr as Error).message);
        }
      }
    }
  }

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

  revalidatePath('/dashboard/configuration');
  return ok(null);
}
