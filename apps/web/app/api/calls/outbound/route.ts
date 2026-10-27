import { normalizePatientPhone } from '@/lib/agenda/patients';
import { denyUnlessRole } from '@/lib/auth/api-guard';
import {
  describeAllowedCountries,
  isDestinationAllowed,
  parseAllowedCountryCodes,
} from '@/lib/calls/destination-allowlist';
import { triggerCallback } from '@/lib/calls/trigger-callback';
import { type EnabledModules, isModuleEnabled } from '@/lib/modules';
import { getCurrentTenant } from '@/lib/tenant';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  toNumber: z.string().min(7, 'Número de destino requerido'),
  patientName: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  ghlContactId: z.string().optional().nullable(),
  useCase: z.enum(['payment', 'info', 'reminder', 'reactivation', 'custom']).optional().nullable(),
  dynamicVars: z.record(z.string()).optional(),
});

/**
 * Endpoint del dashboard ("Llamar ahora") — disparar callback saliente para
 * un paciente conocido. Auth por sesión Clerk. Delega en triggerCallback que
 * maneja rate-limit + creación de contacto en GHL si falta.
 */
export async function POST(req: NextRequest) {
  let tenantId: string;
  try {
    // Cada llamada gasta minutos: un viewer o un profesional que sólo ve su
    // agenda no la lanzan.
    const denied = await denyUnlessRole('operator');
    if (denied) return denied;
    const { tenant } = await getCurrentTenant();
    if (!isModuleEnabled(tenant.enabledModules as EnabledModules | null, 'outbound')) {
      return NextResponse.json(
        { error: 'Tu clínica no tiene contratadas las llamadas salientes.' },
        { status: 403 },
      );
    }
    tenantId = tenant.id;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Revisa el número y los datos.' }, { status: 422 });
  }

  // Lista blanca de países (fraude IRSF): la misma que la demo, ampliable con
  // OUTBOUND_ALLOWED_COUNTRY_CODES.
  const codes = parseAllowedCountryCodes(
    process.env.OUTBOUND_ALLOWED_COUNTRY_CODES ?? process.env.FUTURA_DEMO_ALLOWED_COUNTRY_CODES,
  );
  const e164 = normalizePatientPhone(parsed.data.toNumber);
  if (e164 && !isDestinationAllowed(e164, codes)) {
    return NextResponse.json(
      { error: `Sólo se puede llamar a ${describeAllowedCountries(codes)}.` },
      { status: 422 },
    );
  }

  const result = await triggerCallback({
    tenantId,
    toNumber: parsed.data.toNumber,
    patientName: parsed.data.patientName ?? null,
    email: parsed.data.email ?? null,
    ghlContactId: parsed.data.ghlContactId ?? null,
    useCase: parsed.data.useCase ?? null,
    dynamicVars: parsed.data.dynamicVars ?? {},
    source: 'manual',
  });

  if (!result.ok) {
    const status = result.reason === 'invalid_input' ? 422 : 400;
    return NextResponse.json({ error: result.error, reason: result.reason }, { status });
  }

  return NextResponse.json({
    callId: result.callId,
    status: result.status,
    contactId: result.contactId,
  });
}
