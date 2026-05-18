import 'server-only';
import { Queue, type JobsOptions } from 'bullmq';

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
export async function sendQueueEvent<K extends QueueName>(
  name: K,
  data: QueueJobs[K],
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

  // Type-level guard: la exhaustividad la garantizan los overloads.
  const _exhaustive: never = name;
  throw new Error(`Queue desconocida: ${String(_exhaustive)}`);
}
