import { encrypt } from '@/lib/crypto';
import { logCallEvent, upsertCall } from '@/lib/data/calls';
import { resolveTenantId } from '@/lib/data/phone-tenant';
import { db } from '@/lib/db/client';
import { outboundTargets, webhookLogs } from '@/lib/db/schema';
import { sendInngestEvent } from '@/lib/inngest/client';
import { verifyRetellSignature } from '@/lib/retell/verify';
import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Retell envía estos eventos al webhook configurado en el dashboard
type RetellEvent = 'call_started' | 'call_ended' | 'call_analyzed';

type RetellCallPayload = {
  event: RetellEvent;
  call: {
    call_id: string;
    agent_id?: string;
    call_status?: string;
    from_number?: string;
    to_number?: string;
    start_timestamp?: number; // ms
    end_timestamp?: number; // ms
    transcript?: string;
    call_analysis?: {
      call_summary?: string;
      user_sentiment?: string;
      in_voicemail?: boolean;
      call_successful?: boolean;
    };
    metadata?: Record<string, unknown>;
  };
};

export async function POST(req: NextRequest) {
  const rawBody = Buffer.from(await req.arrayBuffer());
  const signature = req.headers.get('x-retell-signature');
  const apiKey = process.env.RETELL_API_KEY ?? '';

  const signatureValid = await verifyRetellSignature(rawBody, signature, apiKey);

  // Loguear siempre para auditoria, incluso si la firma falla
  await db.insert(webhookLogs).values({
    source: 'retell',
    signatureValid,
    statusCode: signatureValid ? 200 : 401,
    body: JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>,
  });

  if (!signatureValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: RetellCallPayload;
  try {
    payload = JSON.parse(rawBody.toString('utf8')) as RetellCallPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { event, call } = payload;

  // Outbound: tenant_id viene en metadata. Inbound: lo resolvemos por to_number.
  const tenantId = await resolveTenantId({
    metadataTenantId: call.metadata?.tenant_id as string | undefined,
    toNumber: call.to_number,
  });
  if (!tenantId) {
    return NextResponse.json(
      { error: 'No se pudo resolver tenant: número de destino no registrado' },
      { status: 400 },
    );
  }

  await logCallEvent({ tenantId, callId: call.call_id, event, payload: payload.call });

  // Si el call viene de una campaña outbound, sincronizar el target.
  const campaignId = call.metadata?.campaign_id as string | undefined;
  const targetId = call.metadata?.target_id as string | undefined;

  switch (event) {
    case 'call_started': {
      await upsertCall({
        tenantId,
        retellCallId: call.call_id,
        fromNumber: call.from_number ?? null,
        toNumber: call.to_number ?? null,
        startedAt: call.start_timestamp ? new Date(call.start_timestamp) : new Date(),
        status: 'ongoing',
      });
      if (targetId) {
        await db
          .update(outboundTargets)
          .set({
            status: 'ongoing',
            retellCallId: call.call_id,
            lastAttemptAt: new Date(),
          })
          .where(and(eq(outboundTargets.id, targetId), eq(outboundTargets.tenantId, tenantId)));
      }
      break;
    }

    case 'call_ended': {
      const start = call.start_timestamp ? new Date(call.start_timestamp) : null;
      const end = call.end_timestamp ? new Date(call.end_timestamp) : null;
      const durationSeconds =
        start && end ? Math.round((end.getTime() - start.getTime()) / 1000) : null;

      await upsertCall({
        tenantId,
        retellCallId: call.call_id,
        fromNumber: call.from_number ?? null,
        toNumber: call.to_number ?? null,
        startedAt: start,
        endedAt: end,
        durationSeconds,
        status: call.call_status ?? 'ended',
      });

      if (targetId) {
        const disconnectionReason = (call as { disconnection_reason?: string })
          .disconnection_reason;
        const status = mapOutboundStatus(call.call_status, disconnectionReason);
        await db
          .update(outboundTargets)
          .set({
            status,
            retellCallId: call.call_id,
            lastDisconnectionReason: disconnectionReason ?? null,
            lastAttemptAt: end ?? new Date(),
          })
          .where(and(eq(outboundTargets.id, targetId), eq(outboundTargets.tenantId, tenantId)));
      }
      void campaignId; // reservado para Entrega 2: chequear si la campaña ya completó
      break;
    }

    case 'call_analyzed': {
      const analysis = call.call_analysis;
      const transcriptEnc = call.transcript ? encrypt(call.transcript) : null;

      // Resumen rápido en español usando Gemini (si está disponible).
      // El job Inngest después puede sobreescribir con OpenAI si está configurado.
      let summaryEs: string | null = analysis?.call_summary ?? null;
      let intentEs: string | null = null;
      let sentimentEs: string | null = mapRetellSentiment(analysis?.user_sentiment);

      if (call.transcript && process.env.GEMINI_API_KEY) {
        try {
          const { summarizeCallWithGemini } = await import('@/lib/gemini/client');
          const ai = await summarizeCallWithGemini(call.transcript);
          summaryEs = ai.summary;
          intentEs = ai.intent;
          sentimentEs = ai.sentiment;
        } catch (err) {
          console.error('[retell-webhook] gemini summary fallo:', err);
        }
      }

      await upsertCall({
        tenantId,
        retellCallId: call.call_id,
        status: 'ended',
        transcriptEnc,
        summary: summaryEs,
        intent: intentEs,
        sentiment: sentimentEs,
      });

      // Dispatch al job de procesamiento async — fire-and-forget
      const recordingUrl =
        typeof (call as { recording_url?: unknown }).recording_url === 'string'
          ? ((call as { recording_url?: string }).recording_url ?? null)
          : null;
      await sendInngestEvent('call/process.requested', {
        data: {
          tenantId,
          retellCallId: call.call_id,
          recordingUrl,
          transcript: call.transcript ?? null,
          analysisSummary: analysis?.call_summary ?? null,
        },
      });
      break;
    }
  }

  return NextResponse.json({ ok: true });
}

function mapOutboundStatus(
  callStatus: string | undefined,
  disconnectionReason: string | undefined,
): string {
  if (callStatus === 'error') return 'failed';
  if (callStatus === 'not_connected') {
    switch (disconnectionReason) {
      case 'voicemail':
        return 'voicemail';
      case 'dial_no_answer':
        return 'no_answer';
      case 'dial_busy':
        return 'busy';
      default:
        return 'failed';
    }
  }
  return 'ended';
}

function mapRetellSentiment(s: string | null | undefined): string | null {
  if (!s) return null;
  const map: Record<string, string> = {
    Positive: 'positivo',
    Neutral: 'neutro',
    Negative: 'negativo',
    positive: 'positivo',
    neutral: 'neutro',
    negative: 'negativo',
  };
  return map[s] ?? s.toLowerCase();
}
