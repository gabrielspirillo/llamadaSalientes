import { getCall } from '@/lib/data/calls-list';
import { getRetellClient } from '@/lib/retell/client';
import { getCurrentTenant } from '@/lib/tenant';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Diagnóstico: devuelve el raw response de Retell para una llamada
 * + el estado en nuestra DB. Útil para entender por qué falta recording_url.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let tenantId: string;
  try {
    const ctx = await getCurrentTenant();
    tenantId = ctx.tenant.id;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const call = await getCall(tenantId, id);
  if (!call) return NextResponse.json({ error: 'Call not found' }, { status: 404 });

  const result: Record<string, unknown> = {
    db: {
      id: call.id,
      retellCallId: call.retellCallId,
      status: call.status,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      durationSeconds: call.durationSeconds,
      hasTranscript: !!call.transcriptEnc,
      summary: call.summary,
      intent: call.intent,
      recordingR2Key: call.recordingR2Key,
    },
  };

  if (!process.env.RETELL_API_KEY) {
    result.retell = { error: 'RETELL_API_KEY no configurada' };
    return NextResponse.json(result);
  }

  try {
    const retell = getRetellClient();
    const retellCall = (await retell.call.retrieve(call.retellCallId)) as unknown as Record<
      string,
      unknown
    >;
    result.retell = {
      call_id: retellCall.call_id,
      call_type: retellCall.call_type,
      call_status: retellCall.call_status,
      start_timestamp: retellCall.start_timestamp,
      end_timestamp: retellCall.end_timestamp,
      duration_ms:
        typeof retellCall.end_timestamp === 'number' &&
        typeof retellCall.start_timestamp === 'number'
          ? Number(retellCall.end_timestamp) - Number(retellCall.start_timestamp)
          : null,
      has_transcript: !!retellCall.transcript,
      has_recording_url: !!retellCall.recording_url,
      recording_url_preview:
        typeof retellCall.recording_url === 'string'
          ? `${retellCall.recording_url.slice(0, 60)}...`
          : null,
      has_call_analysis: !!retellCall.call_analysis,
      keys: Object.keys(retellCall),
    };
  } catch (err) {
    result.retell = { error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json(result);
}
