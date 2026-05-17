import { recordAudit } from '@/lib/audit';
import {
  getTenantTelephony,
  saveTwilioCredentials,
} from '@/lib/data/tenant-telephony';
import { getCurrentTenant } from '@/lib/tenant';
import { TwilioRestClient } from '@/lib/twilio/client';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  accountSid: z.string().regex(/^AC[a-f0-9]{32}$/i, 'Account SID inválido (formato AC + 32 hex)'),
  authToken: z.string().min(20, 'Auth Token parece demasiado corto'),
});

/** GET → estado actual (enmascarado). */
export async function GET() {
  const { tenant } = await getCurrentTenant().catch(() => ({ tenant: null }));
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const t = await getTenantTelephony(tenant.id);
  return NextResponse.json({
    configured: !!t?.twilioAccountSid,
    accountSid: t?.twilioAccountSid ?? null,
    callerIdE164: t?.callerIdE164 ?? null,
    callerIdVerifiedAt: t?.callerIdVerifiedAt ?? null,
    inboundNumberE164: t?.inboundNumberE164 ?? null,
    inboundConfiguredAt: t?.inboundConfiguredAt ?? null,
    inboundRoute: t?.inboundRoute ?? 'agent',
    inboundForwardNumber: t?.inboundForwardNumber ?? null,
  });
}

/**
 * POST → valida credenciales contra Twilio (Accounts/{sid}.json) y las guarda
 * cifradas. Si Twilio devuelve 401 abortamos sin persistir.
 */
export async function POST(req: NextRequest) {
  const { tenant } = await getCurrentTenant().catch(() => ({ tenant: null }));
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

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
    after: { twilioAccountSid: parsed.data.accountSid },
  });

  return NextResponse.json({ ok: true });
}
