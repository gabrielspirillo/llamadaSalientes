import 'server-only';

import type { StepRunner } from '@/lib/queue/step';
import { listActiveTenantIds, runDailySweepsForTenant } from '@/lib/tasks/materialize';

/**
 * Barrido diario sobre datos de estado.
 *
 * Los eventos (llamada, cancelación, recordatorio) tienen webhook. Estos dos no:
 * nadie emite "el presupuesto de Marta lleva tres semanas parado" ni "Julián
 * no viene desde hace catorce meses". Se recalculan una vez al día.
 */
export async function processTaskDailySweepJob(
  _data: Record<string, never>,
  step: StepRunner,
): Promise<{ tenants: number; pendingTreatment: number; inactive: number; failed: number }> {
  const tenantIds = await step.run('list-tenants', async () => listActiveTenantIds());

  let pendingTreatment = 0;
  let inactive = 0;
  let failed = 0;

  for (const tenantId of tenantIds) {
    try {
      const res = await runDailySweepsForTenant(tenantId);
      pendingTreatment += res.pendingTreatment;
      inactive += res.inactive;
      // Mensajes: UN resumen diario de lo vencido en el canal por defecto, no
      // una tarjeta por tarea. Best-effort — no puede tumbar el barrido.
      try {
        const { postTaskOverdueDigest } = await import('@/lib/messaging/bot');
        await postTaskOverdueDigest({ tenantId });
      } catch (err) {
        console.warn('[task-daily-sweep] digest de mensajes falló', (err as Error).message);
      }
    } catch (err) {
      failed += 1;
      console.error('[task-daily-sweep] tenant failed', {
        tenantId,
        err: (err as Error).message,
      });
    }
  }

  return { tenants: tenantIds.length, pendingTreatment, inactive, failed };
}
