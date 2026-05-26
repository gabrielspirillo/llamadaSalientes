import {
  getTelephonyProvider,
  getTwilioClientFor,
  getZadarmaClientFor,
  upsertTenantTelephony,
} from '@/lib/data/tenant-telephony';
import { recordAudit } from '@/lib/audit';
import { TwilioApiError } from '@/lib/twilio/client';
import { ZadarmaApiError } from '@/lib/zadarma/client';
import { getCurrentTenant } from '@/lib/tenant';
import { env } from '@/lib/env';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /**
   * Identificador del número a configurar como entrante:
   *   - Twilio: SID del IncomingPhoneNumber (PN[hex]{32}).
   *   - Zadarma: número en E.164 con "+".
   */
  sid: z.string().min(3, 'sid requerido'),
  route: z.enum(['agent', 'forward']).default('agent'),
  forwardNumber: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),
});

/**
 * POST → marca un número como "entrada" del tenant y configura los webhooks
 * del provider activo para que apunten a nuestro endpoint correspondiente.
 *
 * Twilio:
 *   - Setea VoiceUrl/SmsUrl del IncomingPhoneNumber al webhook TwiML.
 * Zadarma:
 *   - Registra la URL de notificación NOTIFY_* (es a nivel cuenta, no por
 *     número — Zadarma sólo permite UN webhook por cuenta).
 *   - Persistimos `inbound_number_e164` para que `findTenantByInboundNumber`
 *     pueda enrutarnos.
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

  const provider = await getTelephonyProvider(tenant.id);
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');

  try {
    if (provider === 'twilio') {
      if (!/^PN[a-f0-9]{32}$/i.test(parsed.data.sid)) {
        return NextResponse.json(
          { error: 'IncomingPhoneNumber SID inválido (PN + 32 hex)' },
          { status: 422 },
        );
      }
      const { client } = await getTwilioClientFor(tenant.id);
      const voiceUrl = `${baseUrl}/api/twilio/inbound-voice`;
      const smsUrl = `${baseUrl}/api/twilio/sms-passthrough`;
      const updated = await client.updateIncomingPhoneNumber(parsed.data.sid, {
        voiceUrl,
        voiceMethod: 'POST',
        smsUrl,
        smsMethod: 'POST',
        friendlyName: `Tenant ${tenant.slug}`,
      });

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
          provider,
          inboundNumberE164: updated.phone_number,
          inboundRoute: parsed.data.route,
          voiceUrl,
        },
      });

      return NextResponse.json({
        ok: true,
        provider,
        inboundNumberE164: stored.inboundNumberE164,
        voiceUrl,
        smsUrl,
      });
    }

    // Zadarma
    if (!/^\+[1-9]\d{6,14}$/.test(parsed.data.sid)) {
      return NextResponse.json(
        { error: 'Para Zadarma, el `sid` debe ser el número en E.164 (ej. +34911234567)' },
        { status: 422 },
      );
    }
    const { client } = await getZadarmaClientFor(tenant.id);
    const voiceUrl = `${baseUrl}/api/zadarma/webhook`;
    await client.setNotificationUrl(voiceUrl);

    const stored = await upsertTenantTelephony(tenant.id, {
      inboundNumberE164: parsed.data.sid,
      // Zadarma no tiene SID por número; lo dejamos null.
      inboundNumberSid: null,
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
        provider,
        inboundNumberE164: stored.inboundNumberE164,
        inboundRoute: parsed.data.route,
        voiceUrl,
      },
    });

    return NextResponse.json({
      ok: true,
      provider,
      inboundNumberE164: stored.inboundNumberE164,
      voiceUrl,
      smsUrl: null,
    });
  } catch (err) {
    if (err instanceof TwilioApiError || err instanceof ZadarmaApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
