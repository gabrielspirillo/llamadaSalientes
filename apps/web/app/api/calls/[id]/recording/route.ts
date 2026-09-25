import { getCall } from '@/lib/data/calls-list';
import { getRetellClient } from '@/lib/retell/client';
import { getCurrentTenant } from '@/lib/tenant';
import { type NextRequest, NextResponse } from 'next/server';

/** Tope de espera al pedirle la grabación a Retell. */
const RECORDING_TIMEOUT_MS = 30_000;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sirve la grabación de una llamada haciendo proxy al recording_url de Retell.
 *
 *  - GET: streamea el audio (200 + body o 425 si todavía no está listo).
 *  - HEAD: solo verifica disponibilidad sin descargar el blob de Retell.
 *
 * (Proxy en vez de redirect para que el <audio> tag no tenga problemas
 * de CORS con el dominio de Retell.)
 */

async function authorize(callId: string) {
  let tenantId: string;
  try {
    const ctx = await getCurrentTenant();
    tenantId = ctx.tenant.id;
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const call = await getCall(tenantId, callId);
  if (!call) {
    return { error: NextResponse.json({ error: 'Call not found' }, { status: 404 }) };
  }
  if (!process.env.RETELL_API_KEY) {
    return { error: NextResponse.json({ error: 'Retell no configurado' }, { status: 503 }) };
  }
  return { call };
}

async function getRecordingUrl(retellCallId: string): Promise<string | null> {
  const retell = getRetellClient();
  const retellCall = await retell.call.retrieve(retellCallId);
  return (retellCall as { recording_url?: string | null }).recording_url ?? null;
}

export async function HEAD(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if ('error' in auth) return auth.error;

  try {
    const url = await getRecordingUrl(auth.call.retellCallId);
    if (!url) return new NextResponse(null, { status: 425 });
    return new NextResponse(null, { status: 200 });
  } catch (err) {
    console.error('[recording HEAD]', err);
    return new NextResponse(null, { status: 502 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if ('error' in auth) return auth.error;

  let recordingUrl: string | null = null;
  try {
    recordingUrl = await getRecordingUrl(auth.call.retellCallId);
  } catch (err) {
    console.error('[recording GET] retell.retrieve failed:', err);
    return NextResponse.json({ error: 'Retell error' }, { status: 502 });
  }

  if (!recordingUrl) {
    return NextResponse.json({ error: 'La grabación todavía no está lista' }, { status: 425 });
  }

  // El `Range` del reproductor se reenvía a Retell tal cual. Antes se anunciaba
  // `Accept-Ranges: bytes` sin implementarlo: el navegador se creía que podía
  // saltar por el audio y cada salto volvía a bajarse el archivo entero.
  const range = req.headers.get('range');

  let audioRes: Response;
  try {
    audioRes = await fetch(recordingUrl, {
      headers: range ? { Range: range } : undefined,
      // Una grabación larga tarda, pero sin tope un endpoint que acepta la
      // conexión y no responde deja el request colgado hasta el timeout del
      // runtime.
      signal: AbortSignal.timeout(RECORDING_TIMEOUT_MS),
    });
  } catch (err) {
    console.error('[recording GET] fetch de la grabación falló:', err);
    return NextResponse.json({ error: 'No se pudo leer la grabación' }, { status: 504 });
  }

  if (!audioRes.ok || !audioRes.body) {
    return NextResponse.json(
      { error: `Retell devolvió ${audioRes.status} al pedir la grabación` },
      { status: 502 },
    );
  }

  const headers = new Headers({
    'Content-Type': audioRes.headers.get('content-type') ?? 'audio/wav',
    'Cache-Control': 'private, max-age=3600',
    'Accept-Ranges': 'bytes',
  });
  for (const h of ['content-length', 'content-range'] as const) {
    const v = audioRes.headers.get(h);
    if (v) headers.set(h, v);
  }

  // Se PIPEA el cuerpo en vez de `arrayBuffer()`: buferizar el archivo entero
  // en memoria retenía megas por cada grabación que alguien abriera y no
  // empezaba a servir nada hasta tenerlo todo.
  return new NextResponse(audioRes.body, {
    status: audioRes.status === 206 ? 206 : 200,
    headers,
  });
}
