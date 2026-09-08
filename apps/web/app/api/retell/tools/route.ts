import { resolveTenantId } from '@/lib/data/phone-tenant';
import { buildDemoOverrideFromEnv, withGhlOverride } from '@/lib/ghl/override-context';
import { dispatchTool } from '@/lib/retell/tools';
import { verifyRetellSignature } from '@/lib/retell/verify';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Retell llama este endpoint cuando el agente invoca una tool durante la conversación.
// Body shape (custom function call):
// { name, args: {...}, call: { call_id, to_number, from_number, metadata: { tenant_id?, source? } } }

type RetellToolCallBody = {
  name: string;
  args?: Record<string, unknown>;
  arguments?: Record<string, unknown>; // alias por compat
  call: {
    call_id: string;
    to_number?: string;
    from_number?: string;
    metadata?: { tenant_id?: string; source?: string; direction?: string };
  };
};

/**
 * El número DEL PACIENTE en esta llamada.
 *
 * En una saliente la marcamos nosotros, así que el paciente es `to_number`. En
 * una entrante es al revés: `to_number` es el número de la clínica (de hecho es
 * por el que resolvemos de qué clínica se trata) y el paciente es `from_number`.
 * Tomarlo siempre de `to_number`, como se hacía antes, daba de alta al paciente
 * con el teléfono de la propia clínica en cuanto entraba una llamada.
 */
function patientPhoneOf(call: RetellToolCallBody['call']): string | null {
  const outbound = call.metadata?.direction === 'outbound';
  return (outbound ? call.to_number : call.from_number) ?? null;
}

export async function POST(req: NextRequest) {
  const rawBody = Buffer.from(await req.arrayBuffer());
  const signature = req.headers.get('x-retell-signature');
  const apiKey = process.env.RETELL_API_KEY ?? '';

  if (!(await verifyRetellSignature(rawBody, signature, apiKey))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: RetellToolCallBody;
  try {
    body = JSON.parse(rawBody.toString('utf8')) as RetellToolCallBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const tenantId = await resolveTenantId({
    metadataTenantId: body.call.metadata?.tenant_id,
    toNumber: body.call.to_number,
  });
  if (!tenantId) {
    // Devolvemos 200 con un result entendible para que el agente no quede colgado
    return NextResponse.json({
      result: 'No pude identificar la clínica para esta llamada. El equipo te contactará en breve.',
    });
  }

  const toolArgs = body.args ?? body.arguments ?? {};

  // Fallbacks defensivos: el LLM a veces manda el placeholder textual sin
  // resolver ("+{{to_number}}") o no pasa el contact_id aunque ya lo tengamos
  // en la metadata de la llamada (triggerCallback crea el contacto antes de
  // llamar). Completamos desde body.call para que las tools de agenda no fallen.
  const looksUnresolved = (v: unknown): boolean =>
    typeof v === 'string' && (v.includes('{{') || v.trim() === '' || v.trim() === '+');
  const patientPhone = patientPhoneOf(body.call);
  if (looksUnresolved(toolArgs.phone) && patientPhone) {
    toolArgs.phone = patientPhone;
  }
  const metaContactId = (body.call.metadata as { ghl_contact_id?: string } | undefined)
    ?.ghl_contact_id;
  if (looksUnresolved(toolArgs.contact_id) || (!toolArgs.contact_id && metaContactId)) {
    if (metaContactId) toolArgs.contact_id = metaContactId;
  }

  // `patientPhone` va también en el contexto: cuando el LLM ni siquiera manda
  // el campo (que es lo habitual), el fallback de arriba no se dispara y las
  // tools lo cogen de aquí.
  const ctx = { retellCallId: body.call.call_id, channel: 'VOICE' as const, patientPhone };

  // Override GHL para el flow demo de la landing: si la llamada vino disparada
  // por /api/public/demo-call (metadata.source='landing_demo') y las env vars
  // del override están seteadas, todas las tools resuelven GHL contra el
  // location/PIT/calendar dedicado. El GHL del tenant no se toca.
  const isDemoCall = body.call.metadata?.source === 'landing_demo';
  const ghlOverride = isDemoCall ? buildDemoOverrideFromEnv() : null;

  const toolResult = ghlOverride
    ? await withGhlOverride(ghlOverride, () => dispatchTool(tenantId, body.name, toolArgs, ctx))
    : await dispatchTool(tenantId, body.name, toolArgs, ctx);

  // Retell espera { result: string } como respuesta del tool
  return NextResponse.json(toolResult);
}
