import {
  getTwilioClientFor,
  upsertTenantTelephony,
} from '@/lib/data/tenant-telephony';
import { recordAudit } from '@/lib/audit';
import { TwilioApiError } from '@/lib/twilio/client';
import { getCurrentTenant } from '@/lib/tenant';
import { env } from '@/lib/env';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  sid: z.string().regex(/^PN[a-f0-9]{32}$/i, 'IncomingPhoneNumber SID inválido'),
  /** 'agent' = atender con Retell. 'forward' = redirigir a un número humano. */
  route: z.enum(['agent', 'forward']).default('agent'),
  /** Solo si route='forward'. */
  forwardNumber: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),
});

/**
 * POST → marca un IncomingPhoneNumber como el "número de entrada" de este
 * tenant y configura su VoiceUrl + SmsUrl para que apunten a nuestros
 * webhooks. El tenant queda resoluble por el `To` del webhook.
 *
 * Requisitos:
 *   - El número debe pertenecer al Twilio account ya autorizado por el tenant.
 *   - NEXT_PUBLIC_APP_URL debe estar configurado y ser accesible desde Twilio
 *     (https público, ngrok en dev, etc.).
 */
export async function POST(req: NextRequest) {
  const { tenant } = await getCurrentTenant().catch(() => ({ tenant: null }));
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }
  if (parsed.data.route === 'forward' && !parsed.data.forwardNumber) {
    return NextResponse.json(
      { error: 'forwardNumber requerido cuando route="forward"' },
      { status: 422 },
    );
  }

  let client;
  try {
    ({ client } = await getTwilioClientFor(tenant.id));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  const voiceUrl = `${baseUrl}/api/twilio/inbound-voice`;
  const smsUrl = `${baseUrl}/api/twilio/sms-passthrough`;

  let updated;
  try {
    updated = await client.updateIncomingPhoneNumber(parsed.data.sid, {
      voiceUrl,
      voiceMethod: 'POST',
      smsUrl,
      smsMethod: 'POST',
      friendlyName: `Tenant ${tenant.slug}`,
    });
  } catch (err) {
    if (err instanceof TwilioApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const stored = await upsertTenantTelephony(tenant.id, {
    inboundNumberE164: updated.phone_number,
    inboundNumberSid: updated.sid,
    inboundConfiguredAt: new Date(),
    inboundRoute: parsed.data.route,
    inboundForwardNumber: parsed.data.forwardNumber ?? null,
  });

  await recordAudit({
    tenantId: tenant.id,
    action: 'update',
    entity: 'tenant_telephony',
    entityId: tenant.id,
    before: null,
    after: {
      inboundNumberE164: updated.phone_number,
      inboundRoute: parsed.data.route,
      voiceUrl,
    },
  });

  return NextResponse.json({
    ok: true,
    inboundNumberE164: stored.inboundNumberE164,
    voiceUrl,
    smsUrl,
  });
}
