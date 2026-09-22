import {
  describeAllowedCountries,
  isDestinationAllowed,
  parseAllowedCountryCodes,
} from '@/lib/calls/destination-allowlist';
import { triggerCallback } from '@/lib/calls/trigger-callback';
import { db } from '@/lib/db/client';
import { calls } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { clientIp, consumeRateLimit } from '@/lib/queue/rate-limit';
import { sapinnAgentId, sapinnDynamicVars } from '@/lib/sapinn/demo';
import { and, eq, gte } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  phone: z.string().min(7).max(20),
});

// Ventana mínima entre dos llamadas al mismo número (doble click, reintento).
const RATE_LIMIT_SECONDS = 60;
// Topes de gasto: por IP y hora, y techo global diario.
const CALLS_PER_IP_PER_HOUR = 3;
const CALLS_PER_DAY = 100;

function resolveAllowedOrigin(req: NextRequest): string {
  const origin = req.headers.get('origin') ?? '';
  const list = (env.FUTURA_DEMO_ALLOWED_ORIGINS ?? '')
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
 * Endpoint PÚBLICO de la landing de Sapinn (/sapinn): llama al teléfono del
 * visitante con el agente de FARMACIA (Lucía, nutrición infantil).
 *
 * Existe separado de /api/public/demo-call a propósito. Aquel dispara el
 * agente de clínicas de Futura con `use_case: 'info'`; usarlo aquí hacía que
 * quien pedía la llamada desde la propuesta de Sapinn recibiera a un agente
 * hablando de otro producto. Mismas defensas, distinto agente y distinto guion.
 *
 * Seguridad: lista blanca de países (lo único que frena el fraude IRSF),
 * rate-limit por IP, tope global diario y una llamada por número y minuto.
 */
export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);

  const tenantId = env.FUTURA_DEMO_TENANT_ID;
  if (!tenantId) {
    return NextResponse.json(
      { error: 'La prueba no está disponible ahora mismo. Escríbenos y te la enseñamos.' },
      { status: 503, headers },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 422, headers });
  }

  const phone = normalizeE164(parsed.data.phone);
  if (!phone) {
    return NextResponse.json(
      { error: 'Número no válido. Usa el formato internacional, por ejemplo +34611223344.' },
      { status: 422, headers },
    );
  }

  const ip = clientIp(req);

  // Lista blanca de países ANTES de gastar nada. Rechazar aquí no cuesta y es
  // lo que corta el fraude a numeración de tarificación especial.
  const allowedCodes = parseAllowedCountryCodes(env.FUTURA_DEMO_ALLOWED_COUNTRY_CODES);
  if (!isDestinationAllowed(phone, allowedCodes)) {
    console.warn('[sapinn-call] destino fuera de la lista blanca', {
      ip,
      prefix: phone.slice(0, 5),
    });
    return NextResponse.json(
      {
        error: `Por ahora la prueba sólo puede llamar a números de ${describeAllowedCountries(allowedCodes)}. Escríbenos y te la enseñamos en directo.`,
        reason: 'destination_not_allowed',
      },
      { status: 422, headers },
    );
  }

  const [perIp, perDay] = await Promise.all([
    consumeRateLimit(`sapinn-call:ip:${ip}`, CALLS_PER_IP_PER_HOUR, 3600),
    consumeRateLimit('sapinn-call:global', CALLS_PER_DAY, 86400),
  ]);
  if (!perIp.allowed || !perDay.allowed) {
    return NextResponse.json(
      {
        error: 'Se ha alcanzado el límite de llamadas de prueba. Inténtalo más tarde.',
        reason: 'rate_limited',
      },
      { status: 429, headers },
    );
  }

  const cutoff = new Date(Date.now() - RATE_LIMIT_SECONDS * 1000);
  const [recent] = await db
    .select({ id: calls.id })
    .from(calls)
    .where(
      and(eq(calls.tenantId, tenantId), eq(calls.toNumber, phone), gte(calls.createdAt, cutoff)),
    )
    .limit(1);
  if (recent) {
    return NextResponse.json(
      {
        error: 'Acabamos de llamar a ese número. Inténtalo de nuevo en un minuto.',
        reason: 'rate_limited',
      },
      { status: 429, headers },
    );
  }

  let result: Awaited<ReturnType<typeof triggerCallback>>;
  try {
    result = await triggerCallback({
      tenantId,
      toNumber: phone,
      useCase: 'prueba',
      source: 'sapinn_landing',
      // El agente de farmacia, no el de clínicas: es el motivo de este endpoint.
      agentIdOverride: sapinnAgentId(),
      // Las mismas variables que la llamada por navegador, para que el guion
      // y el saludo sean idénticos por los dos caminos.
      dynamicVars: sapinnDynamicVars(),
    });
  } catch (err) {
    // Sin este catch, una excepción devuelve el 500 de Next sin cabeceras CORS
    // y el navegador lo reporta como un falso error de CORS.
    console.error('[sapinn-call] excepción no controlada:', err);
    return NextResponse.json(
      { error: 'Error interno al lanzar la llamada.', reason: 'internal_error' },
      { status: 500, headers },
    );
  }

  if (!result.ok) {
    const status =
      result.reason === 'invalid_input'
        ? 422
        : result.reason === 'no_agent' || result.reason === 'no_phone'
          ? 503
          : 502;
    return NextResponse.json({ error: result.error, reason: result.reason }, { status, headers });
  }

  return NextResponse.json(
    { ok: true, callId: result.callId, message: 'Te estamos llamando. Descuelga el teléfono.' },
    { headers },
  );
}

function normalizeE164(raw: string): string | null {
  const cleaned = raw.replace(/[\s()-]/g, '').trim();
  if (!cleaned) return null;
  if (cleaned.startsWith('+')) return /^\+\d{7,15}$/.test(cleaned) ? cleaned : null;
  if (/^\d{7,15}$/.test(cleaned)) return `+${cleaned}`;
  return null;
}
