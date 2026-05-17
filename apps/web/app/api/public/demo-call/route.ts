import { triggerCallback } from '@/lib/calls/trigger-callback';
import { db } from '@/lib/db/client';
import { calls } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { and, eq, gte } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  phone: z.string().min(7).max(20),
  name: z.string().trim().min(1).max(80).optional(),
});

// Ventana mínima entre dos llamadas demo al mismo número. Evita spam y
// re-trigger accidental cuando el usuario hace doble click.
const RATE_LIMIT_SECONDS = 180;

function resolveAllowedOrigin(req: NextRequest): string {
  const origin = req.headers.get('origin') ?? '';
  const raw = env.FUTURA_DEMO_ALLOWED_ORIGINS ?? '';
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Si no se configuró nada, devolvemos el origin recibido (modo desarrollo).
  // En prod hay que setear FUTURA_DEMO_ALLOWED_ORIGINS para cerrar el acceso.
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
 * Endpoint PÚBLICO disparado desde la landing (Hostinger). Recibe un número
 * y dispara una llamada saliente del agente Futura "info → invitar a demo".
 *
 * Seguridad:
 *  - CORS restringido a FUTURA_DEMO_ALLOWED_ORIGINS.
 *  - Rate-limit: 1 llamada / RATE_LIMIT_SECONDS por número (vía tabla calls).
 *  - Validación E.164 a través de triggerCallback.
 *  - Sin auth: este endpoint existe específicamente para la landing pública.
 */
export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);

  const tenantId = env.FUTURA_DEMO_TENANT_ID;
  if (!tenantId) {
    return NextResponse.json(
      { error: 'Demo no disponible. Configurá FUTURA_DEMO_TENANT_ID en Vercel.' },
      { status: 503, headers },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400, headers });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Datos inválidos', issues: parsed.error.flatten().fieldErrors },
      { status: 422, headers },
    );
  }

  // Normalización mínima previa al rate-limit (triggerCallback la vuelve a
  // hacer; usamos la misma heurística para que el filtro funcione).
  const phone = normalizeE164(parsed.data.phone);
  if (!phone) {
    return NextResponse.json(
      { error: 'Número de teléfono inválido. Usá formato internacional, ej: +34611223344.' },
      { status: 422, headers },
    );
  }

  // Rate-limit por número: ¿hubo otra llamada demo al mismo teléfono en los
  // últimos RATE_LIMIT_SECONDS segundos?
  const cutoff = new Date(Date.now() - RATE_LIMIT_SECONDS * 1000);
  const [recent] = await db
    .select({ id: calls.id })
    .from(calls)
    .where(
      and(
        eq(calls.tenantId, tenantId),
        eq(calls.toNumber, phone),
        gte(calls.createdAt, cutoff),
      ),
    )
    .limit(1);
  if (recent) {
    return NextResponse.json(
      {
        error: `Ya disparamos una llamada a ese número hace poco. Probá de nuevo en ${RATE_LIMIT_SECONDS / 60} minutos.`,
        reason: 'rate_limited',
      },
      { status: 429, headers },
    );
  }

  let result;
  try {
    result = await triggerCallback({
      tenantId,
      toNumber: phone,
      patientName: parsed.data.name ?? null,
      useCase: 'info',
      source: 'landing_demo',
      // Override del agente: la landing usa SIEMPRE el agente Manuel ("FUTURA
      // Demo Outbound"), independientemente de cuál tenga configurado el
      // dashboard del tenant para outbound. Si la env var no está seteada,
      // cae al agente outbound del tenant (legacy / desarrollo local).
      agentIdOverride: env.FUTURA_DEMO_RETELL_AGENT_ID ?? null,
      dynamicVars: {
        // Variables que el prompt del agente demo lee para personalizar:
        lead_name: parsed.data.name ?? 'visitante',
        // Marca explícita para que el LLM sepa que es la demo pública.
        demo_flow: 'futura_landing',
      },
    });
  } catch (err) {
    // Si triggerCallback (o algo aguas abajo) tira una excepción no controlada,
    // queremos que el browser vea CORS headers + un mensaje legible — NO el
    // 500 default de Next.js (sin headers, que hace que el browser bloquee la
    // respuesta y reporte un falso "CORS error").
    console.error('[demo-call] unhandled exception:', err);
    return NextResponse.json(
      {
        error: 'Error interno disparando la llamada. Avisanos y lo revisamos.',
        reason: 'internal_error',
      },
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
    return NextResponse.json(
      { error: result.error, reason: result.reason },
      { status, headers },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      callId: result.callId,
      status: result.status,
      message: 'Te estamos llamando ahora. Atendé tu teléfono.',
    },
    { headers },
  );
}

function normalizeE164(raw: string): string | null {
  const cleaned = raw.replace(/[\s()-]/g, '').trim();
  if (!cleaned) return null;
  if (cleaned.startsWith('+')) {
    return /^\+\d{7,15}$/.test(cleaned) ? cleaned : null;
  }
  if (/^\d{7,15}$/.test(cleaned)) return `+${cleaned}`;
  return null;
}
