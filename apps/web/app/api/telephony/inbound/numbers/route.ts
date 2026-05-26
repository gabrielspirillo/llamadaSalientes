import {
  getTelephonyProvider,
  getTwilioClientFor,
  getZadarmaClientFor,
} from '@/lib/data/tenant-telephony';
import { TwilioApiError } from '@/lib/twilio/client';
import { ZadarmaApiError } from '@/lib/zadarma/client';
import { getCurrentTenant } from '@/lib/tenant';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET → lista los números entrantes disponibles en la cuenta del provider
 * activo del tenant. Para Twilio devuelve IncomingPhoneNumbers; para
 * Zadarma, los DIDs (`/v1/direct_numbers/`).
 *
 * El shape de la respuesta es uniforme para que la UI no necesite saber
 * el provider:
 *   { numbers: [{ sid, phoneNumber, friendlyName, voiceUrl, smsUrl, capabilities }] }
 *
 * `sid` en Zadarma es el propio número (no hay SID); lo usamos como
 * identificador opaco en el siguiente paso (configure).
 */
export async function GET() {
  const { tenant } = await getCurrentTenant().catch(() => ({ tenant: null }));
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const provider = await getTelephonyProvider(tenant.id);

  try {
    if (provider === 'twilio') {
      const { client } = await getTwilioClientFor(tenant.id);
      const numbers = await client.listIncomingPhoneNumbers();
      return NextResponse.json({
        provider,
        numbers: numbers.map((n) => ({
          sid: n.sid,
          phoneNumber: n.phone_number,
          friendlyName: n.friendly_name,
          voiceUrl: n.voice_url,
          smsUrl: n.sms_url,
          capabilities: n.capabilities,
        })),
      });
    }

    // Zadarma
    const { client } = await getZadarmaClientFor(tenant.id);
    const dids = await client.listDirectNumbers();
    return NextResponse.json({
      provider,
      numbers: dids.map((d) => ({
        // Zadarma devuelve sin "+"; lo agregamos para que la UI lo muestre E.164.
        sid: `+${d.number}`,
        phoneNumber: `+${d.number}`,
        friendlyName: d.description ?? d.type ?? '',
        voiceUrl: null,
        smsUrl: null,
        capabilities: { voice: true, sms: false, mms: false },
      })),
    });
  } catch (err) {
    if (err instanceof TwilioApiError || err instanceof ZadarmaApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
