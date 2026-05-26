import { recordAudit } from '@/lib/audit';
import {
  getTenantTelephony,
  saveTwilioCredentials,
  saveZadarmaCredentials,
} from '@/lib/data/tenant-telephony';
import { getCurrentTenant } from '@/lib/tenant';
import { TwilioRestClient } from '@/lib/twilio/client';
import { ZadarmaRestClient } from '@/lib/zadarma/client';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const twilioBody = z.object({
  provider: z.literal('twilio'),
  accountSid: z.string().regex(/^AC[a-f0-9]{32}$/i, 'Account SID inválido (formato AC + 32 hex)'),
  authToken: z.string().min(20, 'Auth Token parece demasiado corto'),
});

const zadarmaBody = z.object({
  provider: z.literal('zadarma'),
  // User key del cabinet Zadarma → API. Suele ser alfanumérico de ≥20 chars.
  userKey: z.string().min(10, 'User key inválida'),
  secret: z.string().min(10, 'Secret inválido'),
  /** Opcional: secret separado para verificar webhooks NOTIFY_*. */
  webhookSecret: z.string().optional().nullable(),
});

const bodySchema = z.discriminatedUnion('provider', [twilioBody, zadarmaBody]);

/** GET → estado actual del tenant (enmascarado). */
export async function GET() {
  const { tenant } = await getCurrentTenant().catch(() => ({ tenant: null }));
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const t = await getTenantTelephony(tenant.id);
  return NextResponse.json({
    provider: t?.provider ?? 'twilio',
    twilio: {
      configured: !!t?.twilioAccountSid,
      accountSid: t?.twilioAccountSid ?? null,
    },
    zadarma: {
      configured: !!t?.zadarmaUserKey,
      userKey: t?.zadarmaUserKey ?? null,
      webhookSecretSet: !!t?.zadarmaWebhookSecretEnc,
    },
    callerIdE164: t?.callerIdE164 ?? null,
    callerIdVerifiedAt: t?.callerIdVerifiedAt ?? null,
    inboundNumberE164: t?.inboundNumberE164 ?? null,
    inboundConfiguredAt: t?.inboundConfiguredAt ?? null,
    inboundRoute: t?.inboundRoute ?? 'agent',
    inboundForwardNumber: t?.inboundForwardNumber ?? null,
  });
}

/**
 * POST → valida las credenciales con el provider correspondiente y las
 * guarda cifradas. Si el provider rechaza (401/403) abortamos sin persistir.
 *
 * Cambiar el provider activo (twilio→zadarma o viceversa) requiere reenviar
 * credenciales del nuevo provider: el upsert pisa el `provider` actual.
 */
export async function POST(req: NextRequest) {
  const { tenant } = await getCurrentTenant().catch(() => ({ tenant: null }));
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  if (parsed.data.provider === 'twilio') {
    const probe = new TwilioRestClient({
      accountSid: parsed.data.accountSid,
      authToken: parsed.data.authToken,
    });
    let ok: boolean;
    try {
      ok = await probe.ping();
    } catch (err) {
      return NextResponse.json(
        { error: `No se pudo contactar a Twilio: ${(err as Error).message}` },
        { status: 502 },
      );
    }
    if (!ok) {
      return NextResponse.json(
        { error: 'Credenciales rechazadas por Twilio (401/403). Revisá el SID y Auth Token.' },
        { status: 422 },
      );
    }

    await saveTwilioCredentials(tenant.id, parsed.data.accountSid, parsed.data.authToken);

    await recordAudit({
      tenantId: tenant.id,
      action: 'update',
      entity: 'tenant_telephony',
      entityId: tenant.id,
      before: null,
      after: { provider: 'twilio', twilioAccountSid: parsed.data.accountSid },
    });

    return NextResponse.json({ ok: true, provider: 'twilio' });
  }

  // Zadarma
  const probe = new ZadarmaRestClient({
    userKey: parsed.data.userKey,
    secret: parsed.data.secret,
  });
  let ok: boolean;
  try {
    ok = await probe.ping();
  } catch (err) {
    return NextResponse.json(
      { error: `No se pudo contactar a Zadarma: ${(err as Error).message}` },
      { status: 502 },
    );
  }
  if (!ok) {
    return NextResponse.json(
      { error: 'Credenciales rechazadas por Zadarma (401/403). Revisá la User Key y el Secret.' },
      { status: 422 },
    );
  }

  await saveZadarmaCredentials(
    tenant.id,
    parsed.data.userKey,
    parsed.data.secret,
    parsed.data.webhookSecret ?? null,
  );

  await recordAudit({
    tenantId: tenant.id,
    action: 'update',
    entity: 'tenant_telephony',
    entityId: tenant.id,
    before: null,
    after: { provider: 'zadarma', zadarmaUserKey: parsed.data.userKey },
  });

  return NextResponse.json({ ok: true, provider: 'zadarma' });
}
