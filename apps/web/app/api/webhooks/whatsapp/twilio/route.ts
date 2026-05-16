import { type NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { whatsappConnections } from '@/lib/db/schema';
import { decrypt } from '@/lib/crypto';
import { env } from '@/lib/env';
import {
  TwilioConnector,
  normalizeTwilioMessage,
  persistInboundMessage,
  twilioInboundFormSchema,
} from '@/lib/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Twilio webhook (canal WhatsApp).
 *
 * Twilio entrega payloads form-encoded a la URL configurada. La firma viene en
 * `X-Twilio-Signature` (base64 de HMAC-SHA1 sobre URL + sortedConcat(params)).
 * Cada tenant tiene su propio auth_token cifrado en BD. Resolvemos el tenant
 * por el `To` (que es nuestro `from_number`) antes de validar la firma.
 *
 * A diferencia de Meta, no hay handshake GET — solo POST.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('application/x-www-form-urlencoded')) {
    return NextResponse.json(
      { error: 'expected application/x-www-form-urlencoded' },
      { status: 415 },
    );
  }

  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));
  const sigHeader = req.headers.get('x-twilio-signature') ?? '';

  const parsed = twilioInboundFormSchema.safeParse(params);
  if (!parsed.success) {
    // Twilio reintenta agresivamente; respondemos 200 a payloads que no
    // entendemos (status callbacks, delivery receipts, etc.) para evitar
    // backoff exponencial.
    console.warn('[wa-twilio-webhook] payload no matchea schema', {
      errors: parsed.error.flatten().fieldErrors,
    });
    return NextResponse.json({ ok: true, ignored: 'unknown_payload_shape' });
  }
  const form = parsed.data;

  // To = nuestro from_number. Twilio lo manda como "whatsapp:+E164".
  const toRaw = form.To.replace(/^whatsapp:/, '').trim();

  const conns = await db
    .select()
    .from(whatsappConnections)
    .where(
      and(
        eq(whatsappConnections.mode, 'TWILIO'),
        eq(whatsappConnections.twilioFromNumber, toRaw),
      ),
    )
    .limit(1);
  const conn = conns[0];
  if (!conn || !conn.twilioAccountSid || !conn.twilioAuthTokenEnc) {
    // Tenant desconocido para este sender. 200 para que Twilio no reintente.
    return NextResponse.json({ ok: true, ignored: 'unknown_sender' });
  }

  const twilio = new TwilioConnector({
    accountSid: conn.twilioAccountSid,
    authToken: decrypt(conn.twilioAuthTokenEnc),
    fromNumber: toRaw,
  });

  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  const fullUrl = `${appUrl}/api/webhooks/whatsapp/twilio`;
  if (!twilio.verifyWebhookSignature(fullUrl, params, sigHeader)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const inbound = normalizeTwilioMessage(form, conn.tenantId);
  try {
    await persistInboundMessage(inbound);
  } catch (err) {
    console.error('[wa-twilio-webhook] persistInboundMessage failed', {
      err: (err as Error).message,
      messageId: form.MessageSid,
    });
    return NextResponse.json({ error: 'persist failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, processed: 1 });
}
