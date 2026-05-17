import {
  getTwilioClientFor,
  upsertTenantTelephony,
} from '@/lib/data/tenant-telephony';
import { TwilioApiError } from '@/lib/twilio/client';
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
 * POST → inicia la verificación de un Caller ID en Twilio. Devuelve el
 * `validation_code` que el usuario debe ingresar por DTMF cuando Twilio
 * lo llame al número provisto.
 *
 * Flujo UX:
 *   1. La clínica ingresa su número en el dashboard.
 *   2. Pulsa "Verificar" → este endpoint.
 *   3. La UI muestra el código de 6 dígitos prominentemente.
 *   4. En segundos, Twilio llama al número de la clínica y dicta el código.
 *   5. La persona en la clínica responde y tipea el código en el teléfono.
 *   6. La UI hace polling a /caller-id/status hasta detectar verificado.
 *
 * Guardamos el número como "pendiente" (phone seteado, sid/verifiedAt vacíos)
 * para que el poller sepa qué número estamos esperando.
 */
export async function POST(req: NextRequest) {
  const { tenant } = await getCurrentTenant().catch(() => ({ tenant: null }));
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  let client;
  try {
    ({ client } = await getTwilioClientFor(tenant.id));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  // Si ya está verificado (otro intento previo), saltamos el flujo y lo
  // guardamos directo.
  const existing = await client.listVerifiedCallerIds({ phoneNumber: parsed.data.phoneNumber });
  if (existing.length > 0) {
    const first = existing[0]!;
    await upsertTenantTelephony(tenant.id, {
      callerIdE164: first.phone_number,
      callerIdSid: first.sid,
      callerIdVerifiedAt: new Date(),
    });
    return NextResponse.json({
      alreadyVerified: true,
      phoneNumber: first.phone_number,
      callerIdSid: first.sid,
    });
  }

  try {
    const response = await client.createVerifiedCallerId({
      phoneNumber: parsed.data.phoneNumber,
      friendlyName: parsed.data.friendlyName ?? `Clínica ${tenant.name}`,
    });

    // Marcamos como pendiente: el poller usa callerIdE164 sin sid como señal.
    await upsertTenantTelephony(tenant.id, {
      callerIdE164: response.phone_number,
      callerIdSid: null,
      callerIdVerifiedAt: null,
    });

    return NextResponse.json({
      alreadyVerified: false,
      validationCode: response.validation_code,
      phoneNumber: response.phone_number,
      callSid: response.call_sid,
    });
  } catch (err) {
    if (err instanceof TwilioApiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
