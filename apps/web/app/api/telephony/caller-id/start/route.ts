import {
  getTelephonyProvider,
  getTwilioClientFor,
  getZadarmaClientFor,
  upsertTenantTelephony,
} from '@/lib/data/tenant-telephony';
import { TwilioApiError } from '@/lib/twilio/client';
import { ZadarmaApiError } from '@/lib/zadarma/client';
import { getCurrentTenant } from '@/lib/tenant';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  phoneNumber: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, 'Número en formato E.164 requerido (ej. +5491139530968)'),
  friendlyName: z.string().max(64).optional(),
});

/**
 * POST → inicia verificación del Caller ID saliente para el provider activo.
 *
 * Twilio:
 *   - Crea un OutgoingCallerId pendiente. Devuelve el validation_code que el
 *     usuario debe ingresar por DTMF cuando Twilio llame al número.
 *   - El poller `/caller-id/status` detecta cuándo queda verificado.
 *
 * Zadarma:
 *   - NO ofrece API para iniciar verificación (la verificación se hace en
 *     cabinet.zadarma.com → "My numbers" via SMS o llamada de Zadarma).
 *   - Acá listamos los caller IDs YA verificados en la cuenta. Si el número
 *     pedido aparece, lo guardamos como callerId del tenant y devolvemos
 *     `alreadyVerified: true`. Si no aparece, devolvemos 422 con instrucción
 *     de verificar primero en el cabinet.
 */
export async function POST(req: NextRequest) {
  const { tenant } = await getCurrentTenant().catch(() => ({ tenant: null }));
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const provider = await getTelephonyProvider(tenant.id);

  try {
    if (provider === 'twilio') {
      const { client } = await getTwilioClientFor(tenant.id);

      // Si ya está verificado de un intento previo, saltamos el flow DTMF.
      const existing = await client.listVerifiedCallerIds({
        phoneNumber: parsed.data.phoneNumber,
      });
      if (existing.length > 0) {
        const first = existing[0]!;
        await upsertTenantTelephony(tenant.id, {
          callerIdE164: first.phone_number,
          callerIdSid: first.sid,
          callerIdVerifiedAt: new Date(),
        });
        return NextResponse.json({
          provider,
          alreadyVerified: true,
          phoneNumber: first.phone_number,
          callerIdSid: first.sid,
        });
      }

      const response = await client.createVerifiedCallerId({
        phoneNumber: parsed.data.phoneNumber,
        friendlyName: parsed.data.friendlyName ?? `Clínica ${tenant.name}`,
      });

      await upsertTenantTelephony(tenant.id, {
        callerIdE164: response.phone_number,
        callerIdSid: null,
        callerIdVerifiedAt: null,
      });

      return NextResponse.json({
        provider,
        alreadyVerified: false,
        validationCode: response.validation_code,
        phoneNumber: response.phone_number,
        callSid: response.call_sid,
      });
    }

    // Zadarma — no hay flow API; sólo confirmamos si está pre-verificado.
    const { client } = await getZadarmaClientFor(tenant.id);
    // Quitamos "+" porque Zadarma devuelve los números sin él.
    const normalized = parsed.data.phoneNumber.replace(/^\+/, '');
    const [verified, dids] = await Promise.all([
      client.listVerifiedCallerIds(),
      client.listDirectNumbers(),
    ]);
    const isVerified = verified.some(
      (v) => v.number === normalized && v.status === 'verified',
    );
    const isOwnDid = dids.some((d) => d.number === normalized);

    if (isVerified || isOwnDid) {
      await upsertTenantTelephony(tenant.id, {
        callerIdE164: parsed.data.phoneNumber,
        callerIdSid: null,
        callerIdVerifiedAt: new Date(),
      });
      return NextResponse.json({
        provider,
        alreadyVerified: true,
        phoneNumber: parsed.data.phoneNumber,
        source: isOwnDid ? 'direct_number' : 'verified_caller_id',
      });
    }

    return NextResponse.json(
      {
        error:
          'Zadarma no permite iniciar la verificación por API. Verificá el número primero en cabinet.zadarma.com → My numbers → Add personal number, y reintentá.',
      },
      { status: 422 },
    );
  } catch (err) {
    if (err instanceof TwilioApiError || err instanceof ZadarmaApiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
