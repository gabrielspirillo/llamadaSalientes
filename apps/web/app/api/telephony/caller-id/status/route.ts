import {
  getTelephonyProvider,
  getTenantTelephony,
  getTwilioClientFor,
  getZadarmaClientFor,
  upsertTenantTelephony,
} from '@/lib/data/tenant-telephony';
import { recordAudit } from '@/lib/audit';
import { TwilioApiError } from '@/lib/twilio/client';
import { ZadarmaApiError } from '@/lib/zadarma/client';
import { getCurrentTenant } from '@/lib/tenant';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET → poller para la verificación del Caller ID. La UI lo llama cada 2-3s
 * hasta `verified: true` o timeout local (~3 min, sólo aplica a Twilio).
 *
 * Twilio:
 *   - Lookup /OutgoingCallerIds filtrando por el número pendiente. Si
 *     aparece → guardamos sid + verifiedAt y retornamos verified=true.
 *
 * Zadarma:
 *   - Como el "start" devuelve sincrónicamente verified=true cuando aplica,
 *     el poller acá sólo reconfirma. Si el cabinet revoca el número, eso se
 *     refleja también.
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

  const provider = await getTelephonyProvider(tenant.id);

  try {
    if (provider === 'twilio') {
      const { client } = await getTwilioClientFor(tenant.id);
      const matches = await client.listVerifiedCallerIds({
        phoneNumber: telephony.callerIdE164,
      });
      if (matches.length === 0) {
        return NextResponse.json({
          provider,
          verified: false,
          pendingPhoneNumber: telephony.callerIdE164,
        });
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
        after: {
          callerIdVerifiedAt: updated.callerIdVerifiedAt,
          callerIdSid: first.sid,
        },
      });
      return NextResponse.json({
        provider,
        verified: true,
        phoneNumber: first.phone_number,
        callerIdSid: first.sid,
      });
    }

    // Zadarma
    const { client } = await getZadarmaClientFor(tenant.id);
    const normalized = telephony.callerIdE164.replace(/^\+/, '');
    const [verified, dids] = await Promise.all([
      client.listVerifiedCallerIds(),
      client.listDirectNumbers(),
    ]);
    const ok =
      verified.some((v) => v.number === normalized && v.status === 'verified') ||
      dids.some((d) => d.number === normalized);
    if (!ok) {
      return NextResponse.json({
        provider,
        verified: false,
        pendingPhoneNumber: telephony.callerIdE164,
      });
    }
    const updated = await upsertTenantTelephony(tenant.id, {
      callerIdVerifiedAt: new Date(),
    });
    return NextResponse.json({
      provider,
      verified: true,
      phoneNumber: telephony.callerIdE164,
      callerIdSid: updated.callerIdSid,
    });
  } catch (err) {
    if (err instanceof TwilioApiError || err instanceof ZadarmaApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
