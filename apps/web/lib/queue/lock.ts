import 'server-only';
import { randomUUID } from 'node:crypto';

import { getRedis } from '@/lib/queue/connection';

/**
 * Lock distribuido simple sobre Redis, para jobs que no pueden correr en
 * paralelo sobre la misma entidad.
 *
 * El caso que lo motiva: dos mensajes de WhatsApp seguidos generan dos jobs
 * `wa-process`. El guard `alreadyProcessed` es un read-then-act y la fila de
 * `whatsapp_agent_runs` recién se escribe al final, así que con concurrencia 2
 * ambos jobs veían la conversación libre, llamaban al LLM y le mandaban DOS
 * respuestas al paciente. El UNIQUE de la tabla saltaba cuando el daño ya
 * estaba hecho.
 */

const releaseScript = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

export interface Lock {
  release(): Promise<void>;
}

/** Devuelve null si otro proceso ya lo tiene tomado. */
export async function acquireLock(key: string, ttlMs: number): Promise<Lock | null> {
  const redis = getRedis();
  const token = randomUUID();
  const ok = await redis.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
  if (ok !== 'OK') return null;
  return {
    async release() {
      // Sólo borra si el token sigue siendo nuestro: si el TTL venció y otro
      // proceso tomó el lock, no se lo pisamos.
      await redis.eval(releaseScript, 1, `lock:${key}`, token).catch(() => undefined);
    },
  };
}
