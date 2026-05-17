import { findTenantByInboundNumber } from '@/lib/data/tenant-telephony';
import { getAgentConfig } from '@/lib/data/agent-config';
import { getClinicSettings } from '@/lib/data/clinic';
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
 *   - Las URLs configuradas se generan via /api/telephony/inbound/configure
 *     con NEXT_PUBLIC_APP_URL. Si querés validar firma, agregá lógica
 *     análoga a /api/webhooks/whatsapp/twilio (usa el auth_token del tenant).
 *     De momento no validamos firma acá: el TwiML retornado es sólo
 *     instrucciones — no consulta DB con datos sensibles del caller.
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

  const tenant = await findTenantByInboundNumber(to);
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
