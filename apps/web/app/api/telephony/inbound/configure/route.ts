import {
  getTelephonyProvider,
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
 * POST → marca un número como "entrada" del tenant.
 *
 * Twilio:
 *   - Setea VoiceUrl/SmsUrl del IncomingPhoneNumber via Twilio REST API.
 * Zadarma:
 *   - La API NO expone endpoint para registrar el webhook URL. La config
 *     se hace manualmente en cabinet.zadarma.com → Configuración →
 *     Integraciones → Notificaciones de eventos.
 *   - Acá solo persistimos `inbound_number_e164` y devolvemos la URL que el
 *     usuario tiene que pegar en el cabinet.
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

    // Zadarma: no API call — solo persistir + decirle al user qué pegar
    // manual en cabinet.zadarma.com.
    if (!/^\+[1-9]\d{6,14}$/.test(parsed.data.sid)) {
      return NextResponse.json(
        { error: 'Para Zadarma, el `sid` debe ser el número en E.164 (ej. +34911234567)' },
        { status: 422 },
      );
    }
    const voiceUrl = `${baseUrl}/api/zadarma/webhook`;

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
      manualWebhookConfigRequired: true,
      manualWebhookConfigNote:
        `Pegá ${voiceUrl} en cabinet.zadarma.com → Configuración → Integraciones → Notificaciones de eventos → "Sobre llamadas a la centralita". La API de Zadarma no expone endpoint para hacerlo automático.`,
    });
  } catch (err) {
    if (err instanceof TwilioApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
