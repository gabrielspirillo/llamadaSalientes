import 'server-only';
import { getRedis } from '@/lib/queue/connection';

// Memoización de pasos por job. Reemplaza el `step.run` de Inngest:
// cada paso completado se cachea en Redis bajo `step:{jobId}:{stepId}` con TTL
// 24h. En un retry del job, los pasos completados se devuelven desde caché en
// lugar de re-ejecutar la función — preserva la semántica de "retry parcial".
//
// Constraint: el resultado de step.run debe ser JSON-serializable. Es la misma
// limitación que tenía Inngest. Para objetos con métodos (ej. conector
// WhatsApp), NO usar step.run — instanciar fuera.

const STEP_TTL_SECONDS = 24 * 60 * 60;

export type StepRunner = {
  run: <T>(stepId: string, fn: () => Promise<T>) => Promise<T>;
};

export function createStepRunner(jobId: string): StepRunner {
  const redis = getRedis();
  return {
    async run<T>(stepId: string, fn: () => Promise<T>): Promise<T> {
      const key = `step:${jobId}:${stepId}`;
      const cached = await redis.get(key);
      if (cached !== null) {
        const parsed = JSON.parse(cached) as { v: T };
        return parsed.v;
      }
      const result = await fn();
      // Envolvemos en { v } para preservar undefined/null correctamente.
      await redis.set(key, JSON.stringify({ v: result }), 'EX', STEP_TTL_SECONDS);
      return result;
    },
  };
}
