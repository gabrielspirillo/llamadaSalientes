/* eslint-disable no-console */
// Worker process: consume jobs de las queues BullMQ y los ejecuta.
//
// Arranca con `pnpm --filter web worker` (dev) o `node dist/worker.js` /
// `tsx worker/index.ts` (prod, según Dockerfile.worker).
//
// Concurrencia: 1 por queue por defecto. Subir si la mayoría del tiempo es
// I/O bound (LLM + DB). Ajustable vía WORKER_CONCURRENCY_* env vars.

import 'server-only';
import { type Job, Worker } from 'bullmq';

import { runPendingMigrations } from '@/lib/db/migrate';
import { env } from '@/lib/env';
import { scheduleMessagingCrons, scheduleTaskCrons } from '@/lib/queue/client';
import { getRedis } from '@/lib/queue/connection';
import type { QueueJobs } from '@/lib/queue/queues';
import { createStepRunner } from '@/lib/queue/step';
import { processImDigestJob } from '@/worker/jobs/im-digest';
import { processImMentionEscalateJob } from '@/worker/jobs/im-mention-escalate';
import { processImRetentionSweepJob } from '@/worker/jobs/im-retention-sweep';
import { processCallJob } from '@/worker/jobs/process-call';
import { processReminderFallbackCheckJob } from '@/worker/jobs/reminder-fallback-check';
import { processReminderSendJob } from '@/worker/jobs/reminder-send';
import { processTaskDailySweepJob } from '@/worker/jobs/task-daily-sweep';
import { processTaskRoutinesTickJob } from '@/worker/jobs/task-routines-tick';
import { processWaitlistOfferExpireJob } from '@/worker/jobs/waitlist-offer-expire';
import { processWaitlistOfferSendJob } from '@/worker/jobs/waitlist-offer-send';
import { processWhatsappJob } from '@/worker/jobs/whatsapp-process';

function num(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function logStart(): void {
  console.log('[worker] booting', {
    nodeEnv: env.NODE_ENV,
    redis: env.REDIS_URL ? 'configured' : 'MISSING',
    waConcurrency: num('WORKER_CONCURRENCY_WA', 2),
    callConcurrency: num('WORKER_CONCURRENCY_CALL', 2),
    reminderConcurrency: num('WORKER_CONCURRENCY_REMINDER', 2),
    waitlistConcurrency: num('WORKER_CONCURRENCY_WAITLIST', 2),
    imConcurrency: num('WORKER_CONCURRENCY_IM', 2),
    waEnabled: process.env.WHATSAPP_AGENT_ENABLED === 'true',
  });
}

function buildWaWorker(): Worker<QueueJobs['wa-process']> {
  const worker = new Worker<QueueJobs['wa-process']>(
    'wa-process',
    async (job: Job<QueueJobs['wa-process']>) => {
      const step = createStepRunner(job.id ?? `wa-${job.timestamp}`);
      return processWhatsappJob(job.data, step);
    },
    {
      connection: getRedis(),
      concurrency: num('WORKER_CONCURRENCY_WA', 2),
    },
  );

  worker.on('completed', (job, result) => {
    console.log('[worker:wa-process] completed', {
      jobId: job.id,
      conversationId: job.data.conversationId,
      result,
    });
  });
  worker.on('failed', (job, err) => {
    console.error('[worker:wa-process] failed', {
      jobId: job?.id,
      conversationId: job?.data.conversationId,
      attemptsMade: job?.attemptsMade,
      err: err?.message,
    });
  });

  return worker;
}

function buildCallWorker(): Worker<QueueJobs['process-call']> {
  const worker = new Worker<QueueJobs['process-call']>(
    'process-call',
    async (job: Job<QueueJobs['process-call']>) => {
      const step = createStepRunner(job.id ?? `call-${job.timestamp}`);
      return processCallJob(job.data, step);
    },
    {
      connection: getRedis(),
      concurrency: num('WORKER_CONCURRENCY_CALL', 2),
    },
  );

  worker.on('completed', (job, result) => {
    console.log('[worker:process-call] completed', {
      jobId: job.id,
      retellCallId: job.data.retellCallId,
      result,
    });
  });
  worker.on('failed', (job, err) => {
    console.error('[worker:process-call] failed', {
      jobId: job?.id,
      retellCallId: job?.data.retellCallId,
      attemptsMade: job?.attemptsMade,
      err: err?.message,
    });
  });

  return worker;
}

function buildReminderSendWorker(): Worker<QueueJobs['reminder-send']> {
  const worker = new Worker<QueueJobs['reminder-send']>(
    'reminder-send',
    async (job: Job<QueueJobs['reminder-send']>) => {
      const step = createStepRunner(job.id ?? `rem-${job.timestamp}`);
      return processReminderSendJob(job.data, step);
    },
    {
      connection: getRedis(),
      concurrency: num('WORKER_CONCURRENCY_REMINDER', 2),
    },
  );

  worker.on('completed', (job, result) => {
    console.log('[worker:reminder-send] completed', {
      jobId: job.id,
      reminderId: job.data.reminderId,
      result,
    });
  });
  worker.on('failed', (job, err) => {
    console.error('[worker:reminder-send] failed', {
      jobId: job?.id,
      reminderId: job?.data.reminderId,
      attemptsMade: job?.attemptsMade,
      err: err?.message,
    });
  });

  return worker;
}

function buildWaitlistOfferSendWorker(): Worker<QueueJobs['waitlist-offer-send']> {
  const worker = new Worker<QueueJobs['waitlist-offer-send']>(
    'waitlist-offer-send',
    async (job: Job<QueueJobs['waitlist-offer-send']>) => {
      const step = createStepRunner(job.id ?? `wlo-send-${job.timestamp}`);
      return processWaitlistOfferSendJob(job.data, step);
    },
    {
      connection: getRedis(),
      concurrency: num('WORKER_CONCURRENCY_WAITLIST', 2),
    },
  );

  worker.on('completed', (job, result) => {
    console.log('[worker:waitlist-offer-send] completed', {
      jobId: job.id,
      offerId: job.data.offerId,
      result,
    });
  });
  worker.on('failed', (job, err) => {
    console.error('[worker:waitlist-offer-send] failed', {
      jobId: job?.id,
      offerId: job?.data.offerId,
      attemptsMade: job?.attemptsMade,
      err: err?.message,
    });
  });

  return worker;
}

function buildWaitlistOfferExpireWorker(): Worker<QueueJobs['waitlist-offer-expire']> {
  const worker = new Worker<QueueJobs['waitlist-offer-expire']>(
    'waitlist-offer-expire',
    async (job: Job<QueueJobs['waitlist-offer-expire']>) => {
      const step = createStepRunner(job.id ?? `wlo-exp-${job.timestamp}`);
      return processWaitlistOfferExpireJob(job.data, step);
    },
    {
      connection: getRedis(),
      concurrency: num('WORKER_CONCURRENCY_WAITLIST', 2),
    },
  );

  worker.on('completed', (job, result) => {
    console.log('[worker:waitlist-offer-expire] completed', {
      jobId: job.id,
      offerId: job.data.offerId,
      result,
    });
  });
  worker.on('failed', (job, err) => {
    console.error('[worker:waitlist-offer-expire] failed', {
      jobId: job?.id,
      offerId: job?.data.offerId,
      attemptsMade: job?.attemptsMade,
      err: err?.message,
    });
  });

  return worker;
}

function buildReminderFallbackCheckWorker(): Worker<QueueJobs['reminder-fallback-check']> {
  const worker = new Worker<QueueJobs['reminder-fallback-check']>(
    'reminder-fallback-check',
    async (job: Job<QueueJobs['reminder-fallback-check']>) => {
      const step = createStepRunner(job.id ?? `rem-fb-${job.timestamp}`);
      return processReminderFallbackCheckJob(job.data, step);
    },
    {
      connection: getRedis(),
      concurrency: num('WORKER_CONCURRENCY_REMINDER', 2),
    },
  );

  worker.on('completed', (job, result) => {
    console.log('[worker:reminder-fallback-check] completed', {
      jobId: job.id,
      reminderId: job.data.reminderId,
      result,
    });
  });
  worker.on('failed', (job, err) => {
    console.error('[worker:reminder-fallback-check] failed', {
      jobId: job?.id,
      reminderId: job?.data.reminderId,
      attemptsMade: job?.attemptsMade,
      err: err?.message,
    });
  });

  return worker;
}

function buildTaskRoutinesTickWorker(): Worker<QueueJobs['task-routines-tick']> {
  const worker = new Worker<QueueJobs['task-routines-tick']>(
    'task-routines-tick',
    async (job: Job<QueueJobs['task-routines-tick']>) => {
      const step = createStepRunner(job.id ?? `task-tick-${job.timestamp}`);
      return processTaskRoutinesTickJob(job.data, step);
    },
    {
      connection: getRedis(),
      // Uno solo: el tick recorre todos los tenants y no queremos dos
      // materializaciones simultáneas peleando por el mismo dedupe_key.
      concurrency: 1,
    },
  );

  worker.on('completed', (job, result) => {
    console.log('[worker:task-routines-tick] completed', { jobId: job.id, result });
  });
  worker.on('failed', (job, err) => {
    console.error('[worker:task-routines-tick] failed', {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      err: err?.message,
    });
  });

  return worker;
}

function buildTaskDailySweepWorker(): Worker<QueueJobs['task-daily-sweep']> {
  const worker = new Worker<QueueJobs['task-daily-sweep']>(
    'task-daily-sweep',
    async (job: Job<QueueJobs['task-daily-sweep']>) => {
      const step = createStepRunner(job.id ?? `task-sweep-${job.timestamp}`);
      return processTaskDailySweepJob(job.data, step);
    },
    {
      connection: getRedis(),
      concurrency: 1,
    },
  );

  worker.on('completed', (job, result) => {
    console.log('[worker:task-daily-sweep] completed', { jobId: job.id, result });
  });
  worker.on('failed', (job, err) => {
    console.error('[worker:task-daily-sweep] failed', {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      err: err?.message,
    });
  });

  return worker;
}

function buildImDigestWorker(): Worker<QueueJobs['im-digest']> {
  const worker = new Worker<QueueJobs['im-digest']>(
    'im-digest',
    async (job: Job<QueueJobs['im-digest']>) => {
      const step = createStepRunner(job.id ?? `im-digest-${job.timestamp}`);
      return processImDigestJob(job.data, step);
    },
    {
      connection: getRedis(),
      // Uno solo: el tick recorre todos los tenants y dos corridas simultáneas
      // pelearían por el mismo dedupe_key del resumen del día.
      concurrency: 1,
    },
  );

  worker.on('completed', (job, result) => {
    console.log('[worker:im-digest] completed', { jobId: job.id, result });
  });
  worker.on('failed', (job, err) => {
    console.error('[worker:im-digest] failed', {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      err: err?.message,
    });
  });

  return worker;
}

function buildImMentionEscalateWorker(): Worker<QueueJobs['im-mention-escalate']> {
  const worker = new Worker<QueueJobs['im-mention-escalate']>(
    'im-mention-escalate',
    async (job: Job<QueueJobs['im-mention-escalate']>) => {
      const step = createStepRunner(job.id ?? `im-esc-${job.timestamp}`);
      return processImMentionEscalateJob(job.data, step);
    },
    {
      connection: getRedis(),
      concurrency: num('WORKER_CONCURRENCY_IM', 2),
    },
  );

  worker.on('completed', (job, result) => {
    console.log('[worker:im-mention-escalate] completed', {
      jobId: job.id,
      mentionId: job.data.mentionId,
      result,
    });
  });
  worker.on('failed', (job, err) => {
    console.error('[worker:im-mention-escalate] failed', {
      jobId: job?.id,
      mentionId: job?.data.mentionId,
      attemptsMade: job?.attemptsMade,
      err: err?.message,
    });
  });

  return worker;
}

function buildImRetentionSweepWorker(): Worker<QueueJobs['im-retention-sweep']> {
  const worker = new Worker<QueueJobs['im-retention-sweep']>(
    'im-retention-sweep',
    async (job: Job<QueueJobs['im-retention-sweep']>) => {
      const step = createStepRunner(job.id ?? `im-ret-${job.timestamp}`);
      return processImRetentionSweepJob(job.data, step);
    },
    {
      connection: getRedis(),
      // Borrado por lotes: una sola corrida a la vez, sin excepciones.
      concurrency: 1,
    },
  );

  worker.on('completed', (job, result) => {
    console.log('[worker:im-retention-sweep] completed', { jobId: job.id, result });
  });
  worker.on('failed', (job, err) => {
    console.error('[worker:im-retention-sweep] failed', {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      err: err?.message,
    });
  });

  return worker;
}

async function main(): Promise<void> {
  logStart();

  // Migraciones primero: los handlers asumen que el schema está al día.
  // Nunca tira el proceso — si una falla, se loguea y el worker igual levanta
  // para no dejar a las clínicas sin recordatorios ni waitlist.
  const migrations = await runPendingMigrations().catch((err) => {
    console.error('[worker] runner de migraciones falló', err);
    return null;
  });
  if (migrations?.applied.length) {
    console.log('[worker] migraciones aplicadas', migrations.applied);
  }
  if (migrations?.failed) {
    console.error('[worker] MIGRACIÓN PENDIENTE CON ERROR', migrations.failed);
  }

  const workers = [
    buildWaWorker(),
    buildCallWorker(),
    buildReminderSendWorker(),
    buildReminderFallbackCheckWorker(),
    buildWaitlistOfferSendWorker(),
    buildWaitlistOfferExpireWorker(),
    buildTaskRoutinesTickWorker(),
    buildTaskDailySweepWorker(),
    buildImDigestWorker(),
    buildImMentionEscalateWorker(),
    buildImRetentionSweepWorker(),
  ];

  // Los crons de tareas se registran acá (no en la web) para que existan aunque
  // nadie abra el dashboard. El repeat + jobId fijo los hace idempotentes.
  await scheduleTaskCrons().catch((err) => {
    console.error('[worker] no se pudieron registrar los crons de tareas', err);
  });

  // Ídem para Mensajes: resumen diario cada 30 min y retención a las 04:40 UTC.
  await scheduleMessagingCrons().catch((err) => {
    console.error('[worker] no se pudieron registrar los crons de mensajería', err);
  });

  const shutdown = async (signal: string) => {
    console.log(`[worker] received ${signal}, draining...`);
    await Promise.all(workers.map((w) => w.close()));
    console.log('[worker] all workers closed, exiting');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  console.log('[worker] ready');
}

main().catch((err) => {
  console.error('[worker] fatal error', err);
  process.exit(1);
});
