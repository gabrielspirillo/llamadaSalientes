/* eslint-disable no-console */
// Worker process: consume jobs de las queues BullMQ y los ejecuta.
//
// Arranca con `pnpm --filter web worker` (dev) o `node dist/worker.js` /
// `tsx worker/index.ts` (prod, según Dockerfile.worker).
//
// Concurrencia: 1 por queue por defecto. Subir si la mayoría del tiempo es
// I/O bound (LLM + DB). Ajustable vía WORKER_CONCURRENCY_* env vars.

import 'server-only';
import { Worker, type Job } from 'bullmq';

import { env } from '@/lib/env';
import { getRedis } from '@/lib/queue/connection';
import type { QueueJobs } from '@/lib/queue/queues';
import { createStepRunner } from '@/lib/queue/step';
import { processCallJob } from '@/worker/jobs/process-call';
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

async function main(): Promise<void> {
  logStart();

  const workers = [buildWaWorker(), buildCallWorker()];

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
