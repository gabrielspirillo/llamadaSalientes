import 'server-only';
import { type JobsOptions, Queue } from 'bullmq';

import { env } from '@/lib/env';
import { getRedis } from '@/lib/queue/connection';
import type { QueueJobs, QueueName } from '@/lib/queue/queues';

// Cache de Queue por nombre. Cada Queue mantiene su propia conexión interna
// (más eventos pub/sub que el cliente base), por eso no se recrea.
const _queues = new Map<QueueName, Queue>();

function getQueue<K extends QueueName>(name: K): Queue<QueueJobs[K]> {
  let q = _queues.get(name);
  if (!q) {
    q = new Queue<QueueJobs[K]>(name, { connection: getRedis() });
    _queues.set(name, q);
  }
  return q as Queue<QueueJobs[K]>;
}

// Defaults globales para todos los jobs (consistente con lo que Inngest hacía).
const DEFAULT_OPTS: JobsOptions = {
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 500 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Sender tipado por overload. Replicamos sendInngestEvent.
// ─────────────────────────────────────────────────────────────────────────────

export async function sendQueueEvent(
  name: 'wa-process',
  data: QueueJobs['wa-process'],
): Promise<void>;
export async function sendQueueEvent(
  name: 'process-call',
  data: QueueJobs['process-call'],
): Promise<void>;
export async function sendQueueEvent(
  name: 'reminder-send',
  data: QueueJobs['reminder-send'],
  opts?: { delayMs?: number },
): Promise<void>;
export async function sendQueueEvent(
  name: 'reminder-fallback-check',
  data: QueueJobs['reminder-fallback-check'],
  opts?: { delayMs?: number },
): Promise<void>;
export async function sendQueueEvent(
  name: 'waitlist-offer-send',
  data: QueueJobs['waitlist-offer-send'],
  opts?: { delayMs?: number },
): Promise<void>;
export async function sendQueueEvent(
  name: 'waitlist-offer-expire',
  data: QueueJobs['waitlist-offer-expire'],
  opts?: { delayMs?: number },
): Promise<void>;
export async function sendQueueEvent(
  name: 'task-routines-tick',
  data: QueueJobs['task-routines-tick'],
  opts?: { delayMs?: number },
): Promise<void>;
export async function sendQueueEvent(
  name: 'task-daily-sweep',
  data: QueueJobs['task-daily-sweep'],
  opts?: { delayMs?: number },
): Promise<void>;
export async function sendQueueEvent(
  name: 'im-digest',
  data: QueueJobs['im-digest'],
  opts?: { delayMs?: number },
): Promise<void>;
export async function sendQueueEvent(
  name: 'im-mention-escalate',
  data: QueueJobs['im-mention-escalate'],
  opts?: { delayMs?: number },
): Promise<void>;
export async function sendQueueEvent(
  name: 'im-retention-sweep',
  data: QueueJobs['im-retention-sweep'],
  opts?: { delayMs?: number },
): Promise<void>;
export async function sendQueueEvent<K extends QueueName>(
  name: K,
  data: QueueJobs[K],
  opts?: { delayMs?: number },
): Promise<void> {
  if (!env.REDIS_URL) {
    if (env.NODE_ENV === 'production') {
      console.warn(`[queue] REDIS_URL no seteada, evento ${name} no enviado`);
    } else {
      console.log(`[queue] dev/test sin REDIS_URL, simulando envío de ${name}`);
    }
    return;
  }

  if (name === 'wa-process') {
    const d = data as QueueJobs['wa-process'];
    // jobId único por mensaje para idempotencia de webhooks (Twilio retry).
    // Si el mismo messageId llega 2 veces, BullMQ dedupea el job. La "debounce"
    // de 5s la implementa el `delay`: cada mensaje arma un job retardado;
    // cuando ejecuta, el handler carga el batch completo de inbound nuevos y
    // los que ya tienen agent_run salen por `alreadyProcessed`. Equivalente
    // funcional a la debounce de Inngest a costa de algunas lookups extra.
    const jobId = `wa-${d.conversationId}-${d.messageId}`;
    const queue = getQueue('wa-process');
    await queue.add('wa-process', d, {
      ...DEFAULT_OPTS,
      jobId,
      delay: 5_000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
    });
    return;
  }

  if (name === 'process-call') {
    const d = data as QueueJobs['process-call'];
    // Idempotencia por retellCallId — los webhooks de Retell se reintentan.
    const jobId = `call-${d.retellCallId}`;
    const queue = getQueue('process-call');
    await queue.add('process-call', d, {
      ...DEFAULT_OPTS,
      jobId,
      attempts: 4,
      backoff: { type: 'exponential', delay: 5_000 },
    });
    return;
  }

  if (name === 'reminder-send') {
    const d = data as QueueJobs['reminder-send'];
    const jobId = reminderSendJobId(d.reminderId);
    const queue = getQueue('reminder-send');
    await queue.add('reminder-send', d, {
      ...DEFAULT_OPTS,
      jobId,
      delay: Math.max(0, opts?.delayMs ?? 0),
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
    });
    return;
  }

  if (name === 'reminder-fallback-check') {
    const d = data as QueueJobs['reminder-fallback-check'];
    const jobId = reminderFallbackJobId(d.reminderId);
    const queue = getQueue('reminder-fallback-check');
    await queue.add('reminder-fallback-check', d, {
      ...DEFAULT_OPTS,
      jobId,
      delay: Math.max(0, opts?.delayMs ?? 0),
      attempts: 2,
      backoff: { type: 'exponential', delay: 10_000 },
    });
    return;
  }

  if (name === 'waitlist-offer-send') {
    const d = data as QueueJobs['waitlist-offer-send'];
    const jobId = waitlistOfferSendJobId(d.offerId);
    const queue = getQueue('waitlist-offer-send');
    await queue.add('waitlist-offer-send', d, {
      ...DEFAULT_OPTS,
      jobId,
      delay: Math.max(0, opts?.delayMs ?? 0),
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
    });
    return;
  }

  if (name === 'waitlist-offer-expire') {
    const d = data as QueueJobs['waitlist-offer-expire'];
    const jobId = waitlistOfferExpireJobId(d.offerId);
    const queue = getQueue('waitlist-offer-expire');
    await queue.add('waitlist-offer-expire', d, {
      ...DEFAULT_OPTS,
      jobId,
      delay: Math.max(0, opts?.delayMs ?? 0),
      attempts: 2,
      backoff: { type: 'exponential', delay: 10_000 },
    });
    return;
  }

  if (name === 'task-routines-tick') {
    await getQueue('task-routines-tick').add(
      'task-routines-tick',
      {},
      {
        ...DEFAULT_OPTS,
        delay: Math.max(0, opts?.delayMs ?? 0),
        attempts: 2,
        backoff: { type: 'exponential', delay: 30_000 },
      },
    );
    return;
  }

  if (name === 'task-daily-sweep') {
    await getQueue('task-daily-sweep').add(
      'task-daily-sweep',
      {},
      {
        ...DEFAULT_OPTS,
        delay: Math.max(0, opts?.delayMs ?? 0),
        attempts: 2,
        backoff: { type: 'exponential', delay: 30_000 },
      },
    );
    return;
  }

  if (name === 'im-digest') {
    await getQueue('im-digest').add(
      'im-digest',
      {},
      {
        ...DEFAULT_OPTS,
        delay: Math.max(0, opts?.delayMs ?? 0),
        attempts: 2,
        backoff: { type: 'exponential', delay: 30_000 },
      },
    );
    return;
  }

  if (name === 'im-mention-escalate') {
    const d = data as QueueJobs['im-mention-escalate'];
    // jobId por mención: si el mensaje se reintenta o el usuario recibe dos
    // menciones del mismo mensaje, BullMQ dedupea y sólo queda un escalado.
    const jobId = mentionEscalateJobId(d.mentionId);
    await getQueue('im-mention-escalate').add('im-mention-escalate', d, {
      ...DEFAULT_OPTS,
      jobId,
      delay: Math.max(0, opts?.delayMs ?? 0),
      attempts: 2,
      backoff: { type: 'exponential', delay: 30_000 },
    });
    return;
  }

  if (name === 'im-retention-sweep') {
    await getQueue('im-retention-sweep').add(
      'im-retention-sweep',
      {},
      {
        ...DEFAULT_OPTS,
        delay: Math.max(0, opts?.delayMs ?? 0),
        attempts: 2,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    );
    return;
  }

  // Type-level guard: la exhaustividad la garantizan los overloads.
  const _exhaustive: never = name;
  throw new Error(`Queue desconocida: ${String(_exhaustive)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de jobId y remove. Se exportan para que el scheduler/materializador
// pueda cancelar/re-encolar jobs delayed cuando una cita cambia o se cancela.
// ─────────────────────────────────────────────────────────────────────────────

export function reminderSendJobId(reminderId: string): string {
  return `rem-send-${reminderId}`;
}

export function reminderFallbackJobId(reminderId: string): string {
  return `rem-fb-${reminderId}`;
}

export async function removeReminderSendJob(reminderId: string): Promise<void> {
  if (!env.REDIS_URL) return;
  const queue = getQueue('reminder-send');
  await queue.remove(reminderSendJobId(reminderId)).catch(() => undefined);
}

export async function removeReminderFallbackJob(reminderId: string): Promise<void> {
  if (!env.REDIS_URL) return;
  const queue = getQueue('reminder-fallback-check');
  await queue.remove(reminderFallbackJobId(reminderId)).catch(() => undefined);
}

export function waitlistOfferSendJobId(offerId: string): string {
  return `wlo-send-${offerId}`;
}

export function waitlistOfferExpireJobId(offerId: string): string {
  return `wlo-expire-${offerId}`;
}

export async function removeWaitlistOfferSendJob(offerId: string): Promise<void> {
  if (!env.REDIS_URL) return;
  const queue = getQueue('waitlist-offer-send');
  await queue.remove(waitlistOfferSendJobId(offerId)).catch(() => undefined);
}

export async function removeWaitlistOfferExpireJob(offerId: string): Promise<void> {
  if (!env.REDIS_URL) return;
  const queue = getQueue('waitlist-offer-expire');
  await queue.remove(waitlistOfferExpireJobId(offerId)).catch(() => undefined);
}

export function mentionEscalateJobId(mentionId: string): string {
  return `im-esc-${mentionId}`;
}

/** Se llama al resolver o leer una mención: si nadie la escaló todavía, sobra. */
export async function removeMentionEscalateJob(mentionId: string): Promise<void> {
  if (!env.REDIS_URL) return;
  const queue = getQueue('im-mention-escalate');
  await queue.remove(mentionEscalateJobId(mentionId)).catch(() => undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
// Crons del módulo Tareas.
//
// BullMQ repeatable jobs en vez de un cron del sistema: el worker ya está
// corriendo, sobrevive a los redeploys de Dokploy y no necesita un contenedor
// extra. Se registran al arrancar el worker; el jobId fijo los hace idempotentes.
// ─────────────────────────────────────────────────────────────────────────────

export async function scheduleTaskCrons(): Promise<void> {
  if (!env.REDIS_URL) {
    console.log('[queue] sin REDIS_URL, crons de tareas no registrados');
    return;
  }

  // Cada 15 minutos: cubre clínicas en zonas horarias distintas sin depender
  // de a qué hora arrancó el worker.
  await getQueue('task-routines-tick').add(
    'task-routines-tick',
    {},
    {
      ...DEFAULT_OPTS,
      repeat: { pattern: '*/15 * * * *' },
      jobId: 'task-routines-tick-cron',
    },
  );

  // Una vez al día a las 06:10 UTC: antes de que abra la primera clínica.
  await getQueue('task-daily-sweep').add(
    'task-daily-sweep',
    {},
    {
      ...DEFAULT_OPTS,
      repeat: { pattern: '10 6 * * *' },
      jobId: 'task-daily-sweep-cron',
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Crons del módulo Mensajes.
//
// Gemela de `scheduleTaskCrons()`: mismos repeatable jobs de BullMQ, mismo
// jobId fijo para que registrarlos en cada arranque del worker sea idempotente.
// ─────────────────────────────────────────────────────────────────────────────

export async function scheduleMessagingCrons(): Promise<void> {
  if (!env.REDIS_URL) {
    console.log('[queue] sin REDIS_URL, crons de mensajería no registrados');
    return;
  }

  // Cada 30 minutos: el job mira la timezone de cada clínica y publica el
  // resumen sólo a las que les son las 08:00. El `dedupe_key` por día impide
  // que dos ticks dentro de la misma ventana publiquen dos veces.
  await getQueue('im-digest').add(
    'im-digest',
    {},
    {
      ...DEFAULT_OPTS,
      repeat: { pattern: '*/30 * * * *' },
      jobId: 'im-digest-cron',
    },
  );

  // 04:40 UTC: hueco muerto entre el último turno europeo y la apertura.
  // El borrado por lotes puede tardar y no queremos competir con el tráfico.
  await getQueue('im-retention-sweep').add(
    'im-retention-sweep',
    {},
    {
      ...DEFAULT_OPTS,
      repeat: { pattern: '40 4 * * *' },
      jobId: 'im-retention-sweep-cron',
    },
  );
}
