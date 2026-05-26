import { findTenantByInboundNumber, getZadarmaWebhookSecretFor } from '@/lib/data/tenant-telephony';
import { getAgentConfig } from '@/lib/data/agent-config';
import { getClinicSettings } from '@/lib/data/clinic';
import { verifyZadarmaWebhookSignature } from '@/lib/zadarma/signing';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook unificado para los eventos NOTIFY_* de Zadarma.
 *
 * Zadarma sólo permite UNA notification URL por cuenta (multi-tenant ⇒ una
 * cuenta Zadarma por clínica). Resolvemos el tenant por el `called_did` en
 * llamadas entrantes (NOTIFY_START, NOTIFY_INTERNAL) o por el caller_id
 * (saliente) si hace falta.
 *
 * Eventos relevantes:
 *   - NOTIFY_START: entrante llegó al PBX. Si respondemos con
 *       { redirect: "<sip|number>" } Zadarma enruta la llamada a ese destino.
 *       Si respondemos vacío (204/empty 200) Zadarma sigue su scenario PBX.
 *   - NOTIFY_INTERNAL: la llamada llegó a una extensión interna.
 *   - NOTIFY_ANSWER / NOTIFY_END: lifecycle (sólo para logs).
 *   - NOTIFY_OUT_START / NOTIFY_OUT_END: lifecycle de salientes (para
 *       reconciliar con `calls` table eventualmente).
 *
 * Firma:
 *   Algunos eventos llegan firmados como base64(md5(<fields_concat>+secret)).
 *   Los `<fields_concat>` varían por evento (los docs Zadarma especifican
 *   cuáles). Verificamos cuando el evento es NOTIFY_START (firma documentada
 *   y consistente: call_start + caller_id + called_did + secret).
 *   Si el tenant no tiene webhook_secret configurado, dejamos pasar pero
 *   logueamos un warning.
 *
 * Response shape:
 *   Devolvemos JSON. Si no hay nada que decir, respondemos 200 vacío.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const ctype = req.headers.get('content-type') ?? '';
  const params = ctype.includes('application/json')
    ? (safeJson(rawBody) as Record<string, string> | null) ?? {}
    : Object.fromEntries(new URLSearchParams(rawBody));

  const event = String(params.event ?? '').trim();
  console.log('[zadarma-webhook]', {
    event,
    pbx_call_id: params.pbx_call_id,
    caller_id: params.caller_id,
    called_did: params.called_did,
    internal: params.internal,
    call_start: params.call_start,
  });

  // Handshake inicial Zadarma: cuando se setea por primera vez la URL de
  // notificaciones, Zadarma hace GET con ?zd_echo=<x> y espera que
  // respondamos con el body crudo. También aceptamos vía POST por consistencia.
  const echo = req.nextUrl.searchParams.get('zd_echo') ?? params.zd_echo;
  if (echo) {
    return new NextResponse(String(echo), {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  }

  // Dispatch por evento.
  switch (event) {
    case 'NOTIFY_START':
      return handleNotifyStart(params);
    case 'NOTIFY_INTERNAL':
    case 'NOTIFY_ANSWER':
    case 'NOTIFY_END':
    case 'NOTIFY_OUT_START':
    case 'NOTIFY_OUT_END':
    case 'NOTIFY_RECORD':
      // Por ahora sólo logueamos. La integración con la tabla `calls` puede
      // engancharse acá cuando exista el dispatch outbound vía Zadarma.
      return NextResponse.json({ ok: true });
    default:
      return NextResponse.json({ ok: true, ignored: event || 'unknown' });
  }
}

/** GET → handshake `zd_echo` de Zadarma cuando registramos la URL. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const echo = req.nextUrl.searchParams.get('zd_echo');
  if (echo) {
    return new NextResponse(echo, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  }
  return NextResponse.json({ ok: true, hint: 'Zadarma webhook endpoint' });
}

async function handleNotifyStart(params: Record<string, string>): Promise<NextResponse> {
  const callerId = (params.caller_id ?? '').trim();
  const calledDid = (params.called_did ?? '').trim();
  const callStart = (params.call_start ?? '').trim();
  const signature = (params.signature ?? '').trim();

  // Zadarma devuelve called_did sin "+". Probamos ambas variantes.
  const e164Candidates = [
    calledDid.startsWith('+') ? calledDid : `+${calledDid}`,
    calledDid,
  ];

  let tenant = null;
  for (const candidate of e164Candidates) {
    tenant = await findTenantByInboundNumber(candidate);
    if (tenant) break;
  }

  if (!tenant) {
    console.warn('[zadarma-webhook] tenant no encontrado para called_did=%s', calledDid);
    // Sin tenant no podemos hacer nada útil; hangup implícito por scenario
    // del cabinet. Respondemos vacío.
    return NextResponse.json({});
  }

  // Verificación de firma cuando el tenant tiene secret configurado.
  if (signature) {
    const secret = await getZadarmaWebhookSecretFor(tenant.tenantId);
    if (secret) {
      // NOTIFY_START: signature = base64(md5(call_start + caller_id + called_did + secret))
      const concat = `${callStart}${callerId}${calledDid}`;
      const ok = verifyZadarmaWebhookSignature(concat, secret, signature);
      if (!ok) {
        console.warn('[zadarma-webhook] firma inválida para tenant=%s', tenant.tenantId);
        return new NextResponse('invalid signature', { status: 403 });
      }
    }
  }

  // Routing según configuración del tenant.
  if (tenant.inboundRoute === 'forward') {
    const forward = tenant.inboundForwardNumber;
    if (!forward) {
      return NextResponse.json({ hangup: true });
    }
    // Zadarma acepta { redirect: "<E.164 sin '+'>" } en NOTIFY_START.
    return NextResponse.json({ redirect: forward.replace(/^\+/, '') });
  }

  // Modo agente: redirigimos al SIP del agente Retell del tenant.
  // Si no hay agente cargado caemos al transfer_number de la clínica.
  const [agent, clinic] = await Promise.all([
    getAgentConfig(tenant.tenantId, 'inbound'),
    getClinicSettings(tenant.tenantId),
  ]);

  if (agent?.retellAgentId) {
    const sipDomain = process.env.RETELL_SIP_DOMAIN ?? '5t4n6j0wnrl.sip.livekit.cloud';
    // Zadarma acepta SIP URIs en redirect cuando el cabinet tiene un trunk
    // SIP externo configurado. Si no, este redirect fallará en runtime de
    // Zadarma. El operador debe configurar el SIP trunk hacia Retell en el
    // cabinet ANTES de poner el tenant en modo "agent".
    return NextResponse.json({
      redirect: `sip:${agent.retellAgentId}@${sipDomain}`,
    });
  }

  if (clinic?.transferNumber) {
    return NextResponse.json({ redirect: clinic.transferNumber.replace(/^\+/, '') });
  }

  return NextResponse.json({ hangup: true });
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
