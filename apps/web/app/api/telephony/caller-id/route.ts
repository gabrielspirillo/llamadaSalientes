import {
  getTelephonyProvider,
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
 * DELETE → desvincula el Caller ID actual.
 *
 * Twilio: borra el OutgoingCallerId en Twilio (si quedó SID) + limpia DB.
 * Zadarma: sólo limpia DB (Zadarma no expone API para revocar caller IDs;
 *          el cabinet es el que los administra).
 */
export async function DELETE() {
  const { tenant } = await getCurrentTenant().catch(() => ({ tenant: null }));
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const telephony = await getTenantTelephony(tenant.id);
  if (!telephony?.callerIdE164 && !telephony?.callerIdSid) {
    return NextResponse.json({ ok: true, noop: true });
  }

  const provider = await getTelephonyProvider(tenant.id);

  if (provider === 'twilio' && telephony?.callerIdSid) {
    try {
      const { client } = await getTwilioClientFor(tenant.id);
      await client.deleteVerifiedCallerId(telephony.callerIdSid);
    } catch (err) {
      if (err instanceof TwilioApiError && err.status !== 404) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
    }
  }

  const before = {
    callerIdE164: telephony?.callerIdE164,
    callerIdSid: telephony?.callerIdSid,
  };
  await upsertTenantTelephony(tenant.id, {
    callerIdE164: null,
    callerIdSid: null,
    callerIdVerifiedAt: null,
  });
  await recordAudit({
    tenantId: tenant.id,
    action: 'delete',
    entity: 'tenant_telephony',
    entityId: tenant.id,
    before,
    after: null,
  });
  return NextResponse.json({ ok: true });
}
