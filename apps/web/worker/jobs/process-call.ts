import 'server-only';
import { and, eq } from 'drizzle-orm';

import { encrypt } from '@/lib/crypto';
import { upsertCall } from '@/lib/data/calls';
import { db } from '@/lib/db/client';
import {
  appointmentReminders,
  reminderConfirmations,
  whatsappContacts,
  whatsappConversations,
} from '@/lib/db/schema';
import { summarizeCall } from '@/lib/openai/client';
import { buildRecordingKey, fetchAsBuffer, r2Upload } from '@/lib/r2/client';
import type { QueueJobs } from '@/lib/queue/queues';
import {
  removeReminderFallbackJob,
  removeReminderSendJob,
  sendQueueEvent,
} from '@/lib/queue/client';
import type { StepRunner } from '@/lib/queue/step';
import { cancelFollowingReminders } from '@/lib/reminders/cancel';
import { parseReminderVoiceIntent } from '@/lib/reminders/parse-voice-intent';
import { cancelAppointment } from '@/lib/retell/tools';

type SummaryShape = {
  intent: string;
  sentiment: string;
  summary: string;
  followUp: string | null;
};

/**
 * Job principal de procesamiento post-llamada.
 *
 * Trigger: job `process-call` encolado por el webhook Retell cuando llega
 *          el evento `call_analyzed`.
 *
 * Pasos (todos retryables individualmente via step.run con caché en Redis):
 *   1. download-and-upload-recording → bajar audio firmado de Retell + subir a R2
 *   2. summarize-transcript          → analizar transcript con OpenAI
 *   3. persist-results               → escribir todo en la fila de calls
 *
 * Idempotencia: jobId = `call-${retellCallId}`. Si Retell reintenta el
 * webhook, BullMQ dedupea el job (no se encola un duplicado).
 */
export async function processCallJob(
  data: QueueJobs['process-call'],
  step: StepRunner,
): Promise<{ tenantId: string; retellCallId: string; recordingR2Key: string | null; summarized: boolean }> {
  const { tenantId, retellCallId, recordingUrl, transcript, analysisSummary } = data;

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

  let summary: SummaryShape | null = null;
  if (transcript) {
    summary = await step.run<SummaryShape>('summarize-transcript', async () => {
      if (!process.env.OPENAI_API_KEY) {
        return {
          intent: 'otro',
          sentiment: 'neutro',
          summary: analysisSummary ?? 'Sin resumen.',
          followUp: null,
        };
      }
      return summarizeCall(transcript);
    });
  }

  await step.run('persist-results', async () => {
    const transcriptEnc = transcript ? encrypt(transcript) : null;
    await upsertCall({
      tenantId,
      retellCallId,
      status: 'ended',
      transcriptEnc,
      summary: summary?.summary ?? analysisSummary ?? null,
      intent: summary?.intent ?? null,
      sentiment: summary?.sentiment ?? null,
    });

    if (recordingR2Key) {
      const { db } = await import('@/lib/db/client');
      const { calls } = await import('@/lib/db/schema');
      const { eq } = await import('drizzle-orm');
      await db
        .update(calls)
        .set({ recordingR2Key })
        .where(eq(calls.retellCallId, retellCallId));
    }
  });

  // Paso opcional: si esta llamada corresponde a un recordatorio (matchea
  // por external_call_id), parsear intent del transcript y aplicar acción.
  if (transcript) {
    await step.run('match-reminder-intent', async () => {
      return matchReminderIntent({ tenantId, retellCallId, transcript });
    });
  }

  return {
    tenantId,
    retellCallId,
    recordingR2Key,
    summarized: summary !== null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Detección + aplicación de intent en llamadas de recordatorio.
//
// Si la llamada fue disparada por un reminder (lib/reminders/send-voice ya
// guardó el callId en appointment_reminders.external_call_id), parseamos el
// transcript con OpenAI y aplicamos la acción.
//
// Confidence threshold: 0.7 — bajo de eso solo se loguea, no se transiciona.
// ─────────────────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.7;

async function matchReminderIntent(args: {
  tenantId: string;
  retellCallId: string;
  transcript: string;
}): Promise<{ matched: boolean; action?: string; confidence?: number }> {
  const [rem] = await db
    .select()
    .from(appointmentReminders)
    .where(
      and(
        eq(appointmentReminders.tenantId, args.tenantId),
        eq(appointmentReminders.externalCallId, args.retellCallId),
      ),
    )
    .limit(1);

  if (!rem) return { matched: false };

  const intent = await parseReminderVoiceIntent(args.transcript);
  if (intent.action === 'none' || intent.confidence < CONFIDENCE_THRESHOLD) {
    // Loguear en metadata para revisión pero no transicionar.
    await db.insert(reminderConfirmations).values({
      tenantId: args.tenantId,
      reminderId: rem.id,
      action: 'confirm', // placeholder; el caller no actúa con confidence baja.
      source: 'voice',
      metadata: {
        skipped: true,
        reason: 'low_confidence_or_none',
        intent,
      },
    }).catch(() => undefined);
    return { matched: true, action: 'none', confidence: intent.confidence };
  }

  // Insertar confirmation real.
  await db.insert(reminderConfirmations).values({
    tenantId: args.tenantId,
    reminderId: rem.id,
    action: intent.action,
    source: 'voice',
    metadata: {
      confidence: intent.confidence,
      reasoning: intent.reasoning,
      snippet: intent.snippet,
    },
  });

  if (intent.action === 'confirm') {
    await db
      .update(appointmentReminders)
      .set({ status: 'CONFIRMED', respondedAt: new Date(), updatedAt: new Date() })
      .where(eq(appointmentReminders.id, rem.id));
    await Promise.all([
      removeReminderFallbackJob(rem.id),
      cancelFollowingReminders({
        tenantId: args.tenantId,
        ghlAppointmentId: rem.ghlAppointmentId,
        excludeReminderId: rem.id,
      }),
    ]);
  } else if (intent.action === 'cancel') {
    await db
      .update(appointmentReminders)
      .set({ status: 'CANCELLED', respondedAt: new Date(), updatedAt: new Date() })
      .where(eq(appointmentReminders.id, rem.id));
    await Promise.all([
      removeReminderFallbackJob(rem.id),
      cancelFollowingReminders({
        tenantId: args.tenantId,
        ghlAppointmentId: rem.ghlAppointmentId,
        excludeReminderId: rem.id,
      }),
    ]);
    try {
      await cancelAppointment(args.tenantId, { appointment_id: rem.ghlAppointmentId });
    } catch (err) {
      console.warn('[reminder-voice] cancelAppointment GHL failed', err);
    }
  } else if (intent.action === 'reschedule') {
    await db
      .update(appointmentReminders)
      .set({
        status: 'RESCHEDULE_REQUESTED',
        respondedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(appointmentReminders.id, rem.id));
    await removeReminderFallbackJob(rem.id);

    // Buscar conversación WA del contacto para encolar handoff con remindersResume.
    // Si no hay conversación, no podemos seguir vía WA — staff verá el status
    // en pipeline y actuará manualmente.
    const snapshot = (rem.payloadSnapshot ?? {}) as { vars?: { contact?: { phone?: string } } };
    const phone = snapshot.vars?.contact?.phone;
    if (phone) {
      const [contact] = await db
        .select({ id: whatsappContacts.id })
        .from(whatsappContacts)
        .where(
          and(
            eq(whatsappContacts.tenantId, args.tenantId),
            eq(whatsappContacts.phoneE164, phone),
          ),
        )
        .limit(1);

      if (contact) {
        const [conv] = await db
          .select()
          .from(whatsappConversations)
          .where(
            and(
              eq(whatsappConversations.tenantId, args.tenantId),
              eq(whatsappConversations.contactId, contact.id),
            ),
          )
          .limit(1);

        if (conv) {
          const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
          await db
            .update(whatsappConversations)
            .set({
              status: 'ACTIVE',
              aiEnabled: true,
              context: {
                remindersResume: {
                  reminderId: rem.id,
                  action: 'reschedule',
                  ghlAppointmentId: rem.ghlAppointmentId,
                  expiresAt: expiresAt.toISOString(),
                },
              } as Record<string, unknown>,
              updatedAt: new Date(),
            })
            .where(eq(whatsappConversations.id, conv.id));
          // Encolar wa-process para que el agente arranque la negociación.
          // No tenemos un messageId real — usamos un UUID derivado.
          await sendQueueEvent('wa-process', {
            tenantId: args.tenantId,
            conversationId: conv.id,
            messageId: rem.id, // placeholder único
            contactPhoneE164: phone,
          });
        }
      }
    }
  }

  return { matched: true, action: intent.action, confidence: intent.confidence };
}
