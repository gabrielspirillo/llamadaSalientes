import { type NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { whatsappConnections, whatsappMessages } from '@/lib/db/schema';
import { decrypt } from '@/lib/crypto';
import { env } from '@/lib/env';
import { TwilioConnector } from '@/lib/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Status callback de Twilio: cambios de estado para mensajes outbound.
 *
 * Form params típicos: MessageSid, MessageStatus, ErrorCode, ErrorMessage,
 * From, To, AccountSid. La URL la configura nuestro código vía
 * `statusCallbackUrl` en TwilioConnector → cada outbound POST incluye
 * `StatusCallback=https://.../api/webhooks/whatsapp/twilio/status`.
 *
 * Twilio firma el callback igual que el inbound (X-Twilio-Signature).
 * Resolvemos el tenant por el `From` (nuestro from_number) para tomar el
 * auth_token correcto.
 *
 * Mapeo MessageStatus → delivery_status:
 *  - queued, accepted, sending, sent → SENT
 *  - delivered                       → DELIVERED
 *  - read                            → READ
 *  - failed, undelivered             → FAILED (+ failure_reason de ErrorMessage)
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

  const messageSid = params.MessageSid;
  const messageStatus = params.MessageStatus;
  const from = params.From; // whatsapp:+E164 — nuestro from-number
  if (!messageSid || !messageStatus || !from) {
    return NextResponse.json({ ok: true, ignored: 'incomplete_payload' });
  }

  // Resolver tenant por from-number (sin prefijo whatsapp:).
  const fromRaw = from.replace(/^whatsapp:/, '').trim();
  const conns = await db
    .select()
    .from(whatsappConnections)
    .where(
      and(
        eq(whatsappConnections.mode, 'TWILIO'),
        eq(whatsappConnections.twilioFromNumber, fromRaw),
      ),
    )
    .limit(1);
  const conn = conns[0];
  if (!conn || !conn.twilioAccountSid || !conn.twilioAuthTokenEnc) {
    return NextResponse.json({ ok: true, ignored: 'unknown_sender' });
  }

  // Verificar firma con el auth_token del tenant.
  const twilio = new TwilioConnector({
    accountSid: conn.twilioAccountSid,
    authToken: decrypt(conn.twilioAuthTokenEnc),
    fromNumber: fromRaw,
  });
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const fullUrl = host
    ? `${proto}://${host}/api/webhooks/whatsapp/twilio/status`
    : `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/api/webhooks/whatsapp/twilio/status`;
  if (!twilio.verifyWebhookSignature(fullUrl, params, sigHeader)) {
    console.warn('[wa-twilio-status] invalid signature', { fullUrl, messageSid });
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const mapped = mapStatus(messageStatus);
  if (!mapped) {
    return NextResponse.json({ ok: true, ignored: `status=${messageStatus}` });
  }
  if (mapped.status === 'FAILED') {
    const code = params.ErrorCode;
    const errMsg = params.ErrorMessage;
    if (code || errMsg) {
      mapped.failureReason = [code ? `[${code}]` : '', errMsg ?? '']
        .filter(Boolean)
        .join(' ')
        .slice(0, 500);
    }
  }

  // Lookup del mensaje por external_id (MessageSid).
  const rows = await db
    .select({
      id: whatsappMessages.id,
      currentStatus: whatsappMessages.deliveryStatus,
    })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.tenantId, conn.tenantId),
        eq(whatsappMessages.externalId, messageSid),
      ),
    )
    .limit(1);
  const msg = rows[0];
  if (!msg) {
    // El mensaje puede no estar todavía en BD si el callback llega antes
    // del update post-send. Twilio reintenta — devolvemos 200 igual.
    return NextResponse.json({ ok: true, ignored: 'message_not_found' });
  }

  // Evitar regresiones: no pisar DELIVERED/READ con un SENT atrasado.
  const rank: Record<string, number> = {
    PENDING: 0,
    SENT: 1,
    DELIVERED: 2,
    READ: 3,
    FAILED: 4,
  };
  const currentRank = rank[msg.currentStatus ?? 'PENDING'] ?? 0;
  const nextRank = rank[mapped.status] ?? 0;
  if (mapped.status !== 'FAILED' && nextRank <= currentRank) {
    return NextResponse.json({ ok: true, ignored: 'stale_status' });
  }

  await db
    .update(whatsappMessages)
    .set({
      deliveryStatus: mapped.status,
      failureReason: mapped.failureReason ?? null,
    })
    .where(eq(whatsappMessages.id, msg.id));

  return NextResponse.json({ ok: true, status: mapped.status });
}

function mapStatus(
  raw: string,
): { status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'; failureReason?: string } | null {
  switch (raw) {
    case 'queued':
    case 'sent':
      return { status: 'SENT' };
    case 'delivered':
      return { status: 'DELIVERED' };
    case 'read':
      return { status: 'READ' };
    case 'failed':
    case 'undelivered':
      return { status: 'FAILED' };
    default:
      return null;
  }
}
