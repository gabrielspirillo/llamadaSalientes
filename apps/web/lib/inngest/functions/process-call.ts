import 'server-only';
import { encrypt } from '@/lib/crypto';
import { upsertCall } from '@/lib/data/calls';
import { inngest } from '@/lib/inngest/client';
import { summarizeCall } from '@/lib/openai/client';
import { buildRecordingKey, fetchAsBuffer, r2Upload } from '@/lib/r2/client';

type ProcessCallEventData = {
  tenantId: string;
  retellCallId: string;
  recordingUrl?: string | null;
  transcript?: string | null;
  analysisSummary?: string | null;
};

type SummaryShape = {
  intent: string;
  sentiment: string;
  summary: string;
  followUp: string | null;
};

/**
 * Job principal de procesamiento post-llamada.
 *
 * Trigger: evento "call/process.requested" emitido por el webhook Retell
 *          cuando llega "call_analyzed".
 *
 * Pasos (todos retryables individualmente con step.run):
 *   1. download-and-upload-recording → bajar audio firmado de Retell + subir a R2
 *   2. summarize-transcript          → analizar transcript con OpenAI
 *   3. persist-results               → escribir todo en la fila de calls
 *
 * Idempotencia: id por retellCallId. Si Retell reintenta, Inngest dedupe.
 */
export const processCall = inngest.createFunction(
  {
    id: 'process-call',
    name: 'Procesar llamada post-análisis',
    retries: 3,
    idempotency: 'event.data.retellCallId',
    triggers: [{ event: 'call/process.requested' }],
  },
  async ({
    event,
    step,
  }: {
    event: { data: ProcessCallEventData };
    step: {
      run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
    };
  }) => {
    const { tenantId, retellCallId, recordingUrl, transcript, analysisSummary } = event.data;

    let recordingR2Key: string | null = null;
    if (recordingUrl) {
      recordingR2Key = await step.run('download-and-upload-recording', async () => {
        const { buffer, contentType } = await fetchAsBuffer(recordingUrl);
        const ext = contentType.includes('mp3')
          ? 'mp3'
          : contentType.includes('wav')
            ? 'wav'
            : 'audio';
        const key = buildRecordingKey(tenantId, retellCallId, ext);
        await r2Upload({ key, body: buffer, contentType });
        return key;
      });
    }

    // Sin OPENAI_API_KEY no inventamos clasificación: el webhook ya pudo haber
    // guardado una mejor (Gemini) y pisarla con 'otro'/'neutro' sería peor.
    let summary: SummaryShape | null = null;
    if (transcript && process.env.OPENAI_API_KEY) {
      summary = await step.run<SummaryShape>('summarize-transcript', async () =>
        summarizeCall(transcript),
      );
    }

    await step.run('persist-results', async () => {
      // undefined = no tocar la columna (upsertCall hace merge parcial).
      const transcriptEnc = transcript ? encrypt(transcript) : undefined;
      await upsertCall({
        tenantId,
        retellCallId,
        status: 'ended',
        transcriptEnc,
        summary: summary?.summary ?? analysisSummary ?? undefined,
        intent: summary?.intent ?? undefined,
        sentiment: summary?.sentiment ?? undefined,
      });

      if (recordingR2Key) {
        const { db } = await import('@/lib/db/client');
        const { calls } = await import('@/lib/db/schema');
        const { eq } = await import('drizzle-orm');
        await db.update(calls).set({ recordingR2Key }).where(eq(calls.retellCallId, retellCallId));
      }
    });

    return {
      tenantId,
      retellCallId,
      recordingR2Key,
      summarized: summary !== null,
    };
  },
);
