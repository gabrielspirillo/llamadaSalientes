import { type NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { whatsappConnections } from '@/lib/db/schema';
import { decrypt } from '@/lib/crypto';
import {
  WhatsAppCloudConnector,
  cloudWebhookPayloadSchema,
  normalizeCloudMessage,
  persistInboundMessage,
} from '@/lib/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET handshake de Meta. Cuando configuramos el webhook por primera vez,
 * Meta hace GET con hub.mode=subscribe + hub.verify_token + hub.challenge.
 * Si verify_token coincide con WHATSAPP_VERIFY_TOKEN, devolvemos challenge raw.
 */
export function GET(req: NextRequest): NextResponse {
  const params = new URL(req.url).searchParams;
  const mode = params.get('hub.mode');
  const verifyToken = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: 'verify_token not configured' }, { status: 500 });
  }
  if (mode === 'subscribe' && verifyToken === expected && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}

/**
 * POST recibe events de Meta. Validamos firma + parseamos + persistimos
 * inbound de forma sincrónica (no hay worker dedicado todavía; si crece
 * volumen se puede mover a Inngest).
 *
 * La firma viene en X-Hub-Signature-256 = "sha256=<hex>" y es HMAC-SHA256 del
 * raw body con el app secret de la WABA. Cada tenant tiene su propio app
 * secret (cifrado en whatsapp_connections.cloud_app_secret_enc). Resolvemos
 * el tenant por phone_number_id antes de validar la firma.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const sigHeader = req.headers.get('x-hub-signature-256') ?? '';

  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = cloudWebhookPayloadSchema.safeParse(payloadJson);
  if (!parsed.success) {
    // Aceptamos el callback (200) para que Meta no spamee retries por payloads
    // que aún no soportamos (status updates, etc), pero registramos.
    console.warn('[wa-cloud-webhook] payload no matchea schema', {
      errors: parsed.error.flatten().fieldErrors,
    });
    return NextResponse.json({ ok: true, ignored: 'unknown_payload_shape' });
  }

  let processed = 0;
  let invalidSig = false;

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;
      const phoneNumberId = change.value.metadata.phone_number_id;
      const messages = change.value.messages ?? [];
      if (messages.length === 0) continue;

      const conns = await db
        .select()
        .from(whatsappConnections)
        .where(
          and(
            eq(whatsappConnections.mode, 'CLOUD'),
            eq(whatsappConnections.phoneId, phoneNumberId),
          ),
        )
        .limit(1);
      const conn = conns[0];
      if (!conn || !conn.cloudAppSecretEnc) {
        // Tenant desconocido o sin secret cifrado: 200 para que Meta no reintente.
        continue;
      }

      const cloud = new WhatsAppCloudConnector({
        phoneNumberId,
        accessToken: 'unused-for-verify',
        appSecret: decrypt(conn.cloudAppSecretEnc),
      });
      if (!cloud.verifyWebhookSignature(rawBody, sigHeader)) {
        invalidSig = true;
        continue;
      }

      const contacts = change.value.contacts ?? [];
      for (const msg of messages) {
        const contactName =
          contacts.find((c) => c.wa_id === msg.from)?.profile?.name ?? null;
        const inbound = normalizeCloudMessage(msg, conn.tenantId, contactName);
        try {
          await persistInboundMessage(inbound);
          processed += 1;
        } catch (err) {
          console.error('[wa-cloud-webhook] persistInboundMessage failed', {
            err: (err as Error).message,
            messageId: msg.id,
          });
        }
      }
    }
  }

  if (invalidSig && processed === 0) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }
  return NextResponse.json({ ok: true, processed });
}
