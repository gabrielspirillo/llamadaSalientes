import { env } from '@/lib/env';
import { clientIp, consumeRateLimit } from '@/lib/queue/rate-limit';
import { getRetellClient } from '@/lib/retell/client';
import { buildClinicContextVars } from '@/lib/retell/clinic-context';
import { describeRetellError } from '@/lib/retell/errors';
import { sapinnAgentId, sapinnDynamicVars } from '@/lib/sapinn/demo';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
});

// Una llamada web gasta minutos de Retell (voz + LLM mientras dure la
// conversación), así que topamos por IP y con un techo global diario. No hace
// falta allowlist de países: no hay telefonía, es WebRTC navegador → Retell.
// Límites holgados: es una demo que se prueba y se enseña en vivo (cada
// persona es una IP distinta), pero el tope global corta cualquier abuso.
const WEB_CALLS_PER_IP_PER_HOUR = 25;
const WEB_CALLS_PER_DAY = 400;

function resolveAllowedOrigin(req: NextRequest): string {
  const origin = req.headers.get('origin') ?? '';
  const raw = env.FUTURA_DEMO_ALLOWED_ORIGINS ?? '';
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return origin || '*';
  return list.includes(origin) ? origin : (list[0] ?? '*');
}

function corsHeaders(req: NextRequest): HeadersInit {
  return {
    'Access-Control-Allow-Origin': resolveAllowedOrigin(req),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

/**
 * Endpoint PÚBLICO para la landing de Sapinn (/sapinn). Crea una llamada web
 * (WebRTC navegador → Retell) contra el agente saliente de demo y devuelve el
 * access_token que el SDK del cliente usa para conectar el micrófono.
 *
 * A diferencia de /api/public/demo-call, NO usa telefonía: no marca a ningún
 * número, no pasa por Zadarma y no depende de saldo. El visitante hace de
 * "farmacia" y el agente saliente le habla como si le hubiera llamado.
 *
 * Seguridad: rate-limit por IP + tope global (cada prueba gasta minutos de
 * Retell). Sin auth: existe específicamente para la landing pública.
 */
export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);

  const tenantId = env.FUTURA_DEMO_TENANT_ID;
  if (!tenantId) {
    return NextResponse.json(
      { error: 'Demo no disponible. Configurá FUTURA_DEMO_TENANT_ID.' },
      { status: 503, headers },
    );
  }

  if (!process.env.RETELL_API_KEY) {
    return NextResponse.json(
      { error: 'La prueba no está disponible ahora mismo. Escribinos y te la mostramos.' },
      { status: 503, headers },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 422, headers });
  }

  const ip = clientIp(req);
  const [perIp, perDay] = await Promise.all([
    consumeRateLimit(`demo-web:ip:${ip}`, WEB_CALLS_PER_IP_PER_HOUR, 3600),
    consumeRateLimit('demo-web:global', WEB_CALLS_PER_DAY, 86400),
  ]);
  if (!perIp.allowed || !perDay.allowed) {
    return NextResponse.json(
      {
        error: 'Se alcanzó el límite de pruebas por ahora. Probá de nuevo más tarde.',
        reason: 'rate_limited',
      },
      { status: 429, headers },
    );
  }

  // Agente y guion salen de lib/sapinn/demo.ts, el mismo módulo que usa la
  // llamada telefónica, para que los dos caminos de la demo no se separen.
  const agentId = sapinnAgentId();

  try {
    const clinicVars = await buildClinicContextVars(tenantId);
    const retell = getRetellClient();
    const webCall = await retell.call.createWebCall({
      agent_id: agentId,
      metadata: {
        tenant_id: tenantId,
        source: 'sapinn-landing',
        direction: 'outbound',
      },
      retell_llm_dynamic_variables: {
        ...clinicVars,
        ...sapinnDynamicVars(parsed.data.name?.trim() || ''),
      },
    });

    return NextResponse.json(
      { accessToken: webCall.access_token, callId: webCall.call_id },
      { headers },
    );
  } catch (err) {
    const { status, message, detail } = describeRetellError(err);
    console.error('[demo-web-call] fallo al crear la llamada web', { agentId, status, detail });
    return NextResponse.json({ error: message }, { status, headers });
  }
}
