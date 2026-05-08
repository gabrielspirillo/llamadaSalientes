import { logCallEvent, upsertCall } from '@/lib/data/calls';
import { db } from '@/lib/db/client';
import { webhookLogs } from '@/lib/db/schema';
import { encrypt } from '@/lib/crypto';
import { verifyRetellSignature } from '@/lib/retell/verify';
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
  const signingKey = process.env.RETELL_WEBHOOK_SIGNING_KEY ?? '';

  const signatureValid = verifyRetellSignature(rawBody, signature, signingKey);

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

  // El tenantId viene en metadata (lo inyectamos al crear la llamada)
  const tenantId = (call.metadata?.tenant_id as string) ?? null;
  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenant_id in metadata' }, { status: 400 });
  }

  await logCallEvent({ tenantId, callId: call.call_id, event, payload: payload.call });

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
      break;
    }

    case 'call_analyzed': {
      const analysis = call.call_analysis;
      // Cifrar transcript antes de persistir (Fase 5 añade procesamiento async completo)
      const transcriptEnc = call.transcript ? encrypt(call.transcript) : null;

      await upsertCall({
        tenantId,
        retellCallId: call.call_id,
        status: 'ended',
        transcriptEnc,
        summary: analysis?.call_summary ?? null,
        sentiment: analysis?.user_sentiment ?? null,
      });
      break;
    }
  }

  return NextResponse.json({ ok: true });
}
