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
    duration_ms?: number;
    disconnection_reason?: string;
    transcript?: string;
    recording_url?: string;
    call_analysis?: {
      call_summary?: string;
      user_sentiment?: string;
      in_voicemail?: boolean;
      call_successful?: boolean;
    };
    metadata?: Record<string, unknown>;
  };
};

/**
 * Retell manda el objeto `call` completo en los 3 eventos, pero con campos
 * opcionales. Extraemos identidad/tiempos solo cuando vienen, para no pisar con
 * NULL lo que ya guardamos en un evento anterior (upsertCall es un merge parcial).
 */
function identityPatch(call: RetellCallPayload['call']) {
  const start = call.start_timestamp ? new Date(call.start_timestamp) : undefined;
  const end = call.end_timestamp ? new Date(call.end_timestamp) : undefined;
  const durationSeconds =
    start && end
      ? Math.round((end.getTime() - start.getTime()) / 1000)
      : typeof call.duration_ms === 'number'
        ? Math.round(call.duration_ms / 1000)
        : undefined;

  return {
    fromNumber: call.from_number || undefined,
    toNumber: call.to_number || undefined,
    startedAt: start,
    endedAt: end,
    durationSeconds,
  };
}

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
      const identity = identityPatch(call);
      await upsertCall({
        tenantId,
        retellCallId: call.call_id,
        ...identity,
        startedAt: identity.startedAt ?? new Date(),
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
      const identity = identityPatch(call);
      const disconnectionReason = call.disconnection_reason;

      await upsertCall({
        tenantId,
        retellCallId: call.call_id,
        ...identity,
        endedAt: identity.endedAt ?? new Date(),
        status: call.call_status ?? 'ended',
        transferred: disconnectionReason === 'call_transfer',
      });

      if (targetId) {
        const status = mapOutboundStatus(call.call_status, disconnectionReason);
        await db
          .update(outboundTargets)
          .set({
            status,
            retellCallId: call.call_id,
            lastDisconnectionReason: disconnectionReason ?? null,
            lastAttemptAt: identity.endedAt ?? new Date(),
          })
          .where(and(eq(outboundTargets.id, targetId), eq(outboundTargets.tenantId, tenantId)));
      }
      void campaignId; // reservado para Entrega 2: chequear si la campaña ya completó
      break;
    }

    case 'call_analyzed': {
      const analysis = call.call_analysis;
      const identity = identityPatch(call);
      const transcriptEnc = call.transcript ? encrypt(call.transcript) : undefined;

      // Resumen rápido en español usando Gemini (si está disponible).
      // El job Inngest después puede sobreescribir con OpenAI si está configurado.
      let summaryEs: string | undefined = analysis?.call_summary || undefined;
      let intentEs: string | undefined;
      let sentimentEs: string | undefined = mapRetellSentiment(analysis?.user_sentiment);

      if (call.transcript && process.env.GEMINI_API_KEY) {
        try {
          const { summarizeCallWithGemini } = await import('@/lib/gemini/client');
          const ai = await summarizeCallWithGemini(call.transcript);
          summaryEs = ai.summary || summaryEs;
          intentEs = ai.intent || undefined;
          sentimentEs = ai.sentiment || sentimentEs;
        } catch (err) {
          console.error('[retell-webhook] gemini summary fallo:', err);
        }
      }

      await upsertCall({
        tenantId,
        retellCallId: call.call_id,
        // call_analyzed también trae el objeto call completo: aprovechamos para
        // rellenar número/tiempos si el evento call_ended se perdió.
        ...identity,
        status: 'ended',
        transcriptEnc,
        summary: summaryEs,
        intent: intentEs,
        sentiment: sentimentEs,
        ...(call.disconnection_reason === 'call_transfer' ? { transferred: true } : {}),
      });

      // Dispatch al job de procesamiento async — fire-and-forget
      const recordingUrl = call.recording_url ?? null;
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

function mapRetellSentiment(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
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
