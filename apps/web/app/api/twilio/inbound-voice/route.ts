import { createHmac, timingSafeEqual } from 'node:crypto';
import { decrypt } from '@/lib/crypto';
import { getAgentConfig } from '@/lib/data/agent-config';
import { getClinicSettings } from '@/lib/data/clinic';
import { findTenantByInboundNumber } from '@/lib/data/tenant-telephony';
import { env } from '@/lib/env';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook de Voice IN para los números Twilio asignados por-tenant.
 *
 * Flujo:
 *   1. Twilio entrega POST form-encoded con `To` = nuestro número Twilio
 *      (el que la clínica desvía desde su operador).
 *   2. Resolvemos el tenant por ese número.
 *   3. Según la configuración:
 *        - inboundRoute='agent'   → conectamos al agente Retell vía SIP.
 *        - inboundRoute='forward' → <Dial> directo al humano configurado.
 *      Si nada está armado, devolvemos un <Say> + <Hangup> para no
 *      dejar la llamada colgando.
 *
 * Sobre la verificación de firma:
 *   - `X-Twilio-Signature` con el auth token de la clínica, como el webhook de
 *     WhatsApp. Sin firma válida se contesta lo mismo que a un número que no
 *     es nuestro: el TwiML lleva el SIP del agente o el número de desvío, y
 *     distinguir "asignado" de "no asignado" deja enumerar los DIDs.
 *
 * Sobre Retell:
 *   - Retell expone "phone agents" con un SIP URI por agente
 *     (sip:<agent_id>@agents.retellai.com). Acá hacemos <Dial><Sip>...</Sip></Dial>.
 *   - Esto funciona end-to-end cuando el `phoneNumbers.retellPhoneId` del
 *     tenant ya está creado en Retell. Si no, falleamos a un Say genérico.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));
  const to = (params.To ?? '').trim();
  const from = (params.From ?? '').trim();
  const callSid = params.CallSid ?? '';

  console.log('[twilio-inbound-voice]', { to, from, callSid });

  const found = await findTenantByInboundNumber(to);
  const tenant = found && signatureOk(req, params, found.twilioAuthTokenEnc) ? found : null;
  if (!tenant) {
    console.warn('[twilio-inbound-voice] tenant no encontrado para To=%s', to);
    return twiml(`
      <Response>
        <Say language="es-MX">Lo sentimos, este número no está asignado. Intentá más tarde.</Say>
        <Hangup/>
      </Response>
    `);
  }

  // Forward directo si la clínica eligió ese modo.
  if (tenant.inboundRoute === 'forward') {
    const forward = tenant.inboundForwardNumber;
    if (!forward) {
      return twiml(`
        <Response>
          <Say language="es-MX">La clínica no tiene un número de redirección configurado.</Say>
          <Hangup/>
        </Response>
      `);
    }
    // callerId = número original que llamó. Algunas operadoras exigen un
    // Caller ID owned/verified — si tira error, alternativa: usar el número Twilio (To).
    return twiml(`
      <Response>
        <Dial callerId="${escapeXml(from || to)}" timeout="25" answerOnBridge="true">${escapeXml(forward)}</Dial>
      </Response>
    `);
  }

  // Modo agente: necesitamos el SIP URI del agente Retell del tenant.
  // Si el tenant todavía no tiene agente inbound configurado, caemos al
  // transfer-number de la clínica si existe; si no, hangup amable.
  const [agent, clinic] = await Promise.all([
    getAgentConfig(tenant.tenantId, 'inbound'),
    getClinicSettings(tenant.tenantId),
  ]);

  if (agent?.retellAgentId) {
    // Retell acepta llamadas en su SIP gateway. El URI público estándar:
    //   sip:{retell_agent_id}@5t4n6j0wnrl.sip.livekit.cloud
    // Pero el dominio depende del provisioning. Lo dejamos parametrizable
    // por env var; si no está, intentamos el default público.
    const sipDomain = process.env.RETELL_SIP_DOMAIN ?? '5t4n6j0wnrl.sip.livekit.cloud';
    const sipUri = `sip:${agent.retellAgentId}@${sipDomain}`;
    return twiml(`
      <Response>
        <Dial answerOnBridge="true" timeout="25">
          <Sip>${escapeXml(sipUri)}</Sip>
        </Dial>
      </Response>
    `);
  }

  if (clinic?.transferNumber) {
    return twiml(`
      <Response>
        <Say language="es-MX">Conectando con la clínica.</Say>
        <Dial callerId="${escapeXml(to)}" timeout="25" answerOnBridge="true">${escapeXml(clinic.transferNumber)}</Dial>
      </Response>
    `);
  }

  return twiml(`
    <Response>
      <Say language="es-MX">Gracias por llamar. La clínica todavía no terminó su configuración. Intentá nuevamente más tarde.</Say>
      <Hangup/>
    </Response>
  `);
}

function twiml(xml: string): NextResponse {
  // Compactamos whitespace para que el XML sea válido y consistente.
  const cleaned = `<?xml version="1.0" encoding="UTF-8"?>${xml.replace(/>\s+</g, '><').trim()}`;
  return new NextResponse(cleaned, {
    status: 200,
    headers: { 'content-type': 'text/xml; charset=utf-8' },
  });
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;',
  );
}

function signatureOk(
  req: NextRequest,
  params: Record<string, string>,
  authTokenEnc: string | null,
): boolean {
  const header = req.headers.get('x-twilio-signature') ?? '';
  if (!authTokenEnc || !header) return false;
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const url = host
    ? `${proto}://${host}/api/twilio/inbound-voice`
    : `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/api/twilio/inbound-voice`;
  let signed = url;
  for (const k of Object.keys(params).sort()) signed += k + params[k];
  const computed = createHmac('sha1', decrypt(authTokenEnc)).update(signed).digest('base64');
  return (
    computed.length === header.length && timingSafeEqual(Buffer.from(computed), Buffer.from(header))
  );
}
