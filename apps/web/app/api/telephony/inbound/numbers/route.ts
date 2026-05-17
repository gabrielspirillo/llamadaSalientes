import { getTwilioClientFor } from '@/lib/data/tenant-telephony';
import { TwilioApiError } from '@/lib/twilio/client';
import { getCurrentTenant } from '@/lib/tenant';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET → lista los IncomingPhoneNumbers del Twilio account del tenant. */
export async function GET() {
  const { tenant } = await getCurrentTenant().catch(() => ({ tenant: null }));
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let client;
  try {
    ({ client } = await getTwilioClientFor(tenant.id));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  try {
    const numbers = await client.listIncomingPhoneNumbers();
    return NextResponse.json({
      numbers: numbers.map((n) => ({
        sid: n.sid,
        phoneNumber: n.phone_number,
        friendlyName: n.friendly_name,
        voiceUrl: n.voice_url,
        smsUrl: n.sms_url,
        capabilities: n.capabilities,
      })),
    });
  } catch (err) {
    if (err instanceof TwilioApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
