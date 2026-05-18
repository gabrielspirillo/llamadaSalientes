import 'server-only';
import IORedis, { type Redis } from 'ioredis';

import { env } from '@/lib/env';

// Conexión ioredis compartida entre productores (Next.js) y consumidores
// (worker process). BullMQ requiere `maxRetriesPerRequest: null` para que las
// conexiones de blocking commands no se rompan.
let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (_redis) return _redis;
  if (!env.REDIS_URL) {
    throw new Error('REDIS_URL no configurado');
  }
  _redis = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    // Reconnect agresivo: si Redis se reinicia (Dokploy redeploy), volvemos
    // a conectar en lugar de tirar el worker.
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  return _redis;
}
