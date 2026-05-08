import { getCall } from '@/lib/data/calls-list';
import { getRetellClient } from '@/lib/retell/client';
import { getCurrentTenant } from '@/lib/tenant';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sirve la grabación de una llamada haciendo proxy al recording_url de Retell.
 *
 * Estrategia:
 *   1. Verifica que la call pertenece al tenant del usuario.
 *   2. Pide a Retell el recording_url fresco (los URLs son firmados y caducan).
 *   3. Hace fetch del audio y lo retorna con Content-Type correcto.
 *      (Proxy en vez de redirect para que el <audio> tag no tenga problemas
 *      de CORS con el dominio de Retell.)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let tenantId: string;
  try {
    const ctx = await getCurrentTenant();
    tenantId = ctx.tenant.id;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const call = await getCall(tenantId, id);
  if (!call) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 });
  }

  // TODO: si call.recordingR2Key existe, servir desde R2 con signed URL.
  // Por ahora siempre vamos a Retell (funciona sin Inngest configurado).

  if (!process.env.RETELL_API_KEY) {
    return NextResponse.json({ error: 'Retell no configurado' }, { status: 503 });
  }

  const retell = getRetellClient();
  const retellCall = await retell.call.retrieve(call.retellCallId);
  const recordingUrl = (retellCall as { recording_url?: string | null }).recording_url;

  if (!recordingUrl) {
    return NextResponse.json(
      { error: 'La grabación todavía no está lista' },
      { status: 425 }, // Too Early
    );
  }

  const audioRes = await fetch(recordingUrl);
  if (!audioRes.ok) {
    return NextResponse.json(
      { error: `Retell devolvió ${audioRes.status} al pedir la grabación` },
      { status: 502 },
    );
  }

  const contentType = audioRes.headers.get('content-type') ?? 'audio/wav';
  const buffer = Buffer.from(await audioRes.arrayBuffer());

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': buffer.length.toString(),
      'Cache-Control': 'private, max-age=3600',
      'Accept-Ranges': 'bytes',
    },
  });
}
