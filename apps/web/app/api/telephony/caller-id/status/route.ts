import {
  getTenantTelephony,
  getTwilioClientFor,
  upsertTenantTelephony,
} from '@/lib/data/tenant-telephony';
import { recordAudit } from '@/lib/audit';
import { TwilioApiError } from '@/lib/twilio/client';
import { getCurrentTenant } from '@/lib/tenant';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET → poller para la verificación del Caller ID. La UI lo llama cada 2s
 * hasta `verified: true` o timeout local (~3 min).
 *
 * Lookup contra Twilio: listar /OutgoingCallerIds filtrando por el número
 * que tenemos guardado como pendiente. Si aparece → guardamos sid +
 * verifiedAt y retornamos verified=true.
 */
export async function GET() {
  const { tenant } = await getCurrentTenant().catch(() => ({ tenant: null }));
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const telephony = await getTenantTelephony(tenant.id);
  if (!telephony?.callerIdE164) {
    return NextResponse.json({ verified: false, pendingPhoneNumber: null });
  }
  if (telephony.callerIdVerifiedAt) {
    return NextResponse.json({
      verified: true,
      phoneNumber: telephony.callerIdE164,
      callerIdSid: telephony.callerIdSid,
    });
  }

  let client;
  try {
    ({ client } = await getTwilioClientFor(tenant.id));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  try {
    const matches = await client.listVerifiedCallerIds({ phoneNumber: telephony.callerIdE164 });
    if (matches.length === 0) {
      return NextResponse.json({ verified: false, pendingPhoneNumber: telephony.callerIdE164 });
    }
    const first = matches[0]!;
    const updated = await upsertTenantTelephony(tenant.id, {
      callerIdE164: first.phone_number,
      callerIdSid: first.sid,
      callerIdVerifiedAt: new Date(),
    });
    await recordAudit({
      tenantId: tenant.id,
      action: 'update',
      entity: 'tenant_telephony',
      entityId: tenant.id,
      before: { callerIdVerifiedAt: null },
      after: { callerIdVerifiedAt: updated.callerIdVerifiedAt, callerIdSid: first.sid },
    });
    return NextResponse.json({
      verified: true,
      phoneNumber: first.phone_number,
      callerIdSid: first.sid,
    });
  } catch (err) {
    if (err instanceof TwilioApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
