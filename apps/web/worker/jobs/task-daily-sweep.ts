import 'server-only';

import type { StepRunner } from '@/lib/queue/step';
import { reconcileOverdueReminders } from '@/lib/reminders/reconcile';
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
): Promise<{
  tenants: number;
  pendingTreatment: number;
  inactive: number;
  failed: number;
  remindersRequeued: number;
}> {
  const tenantIds = await step.run('list-tenants', async () => listActiveTenantIds());

  // Red de seguridad de los recordatorios: son jobs delayed y viven sólo en
  // Redis, así que un reinicio sin persistencia los borra sin dejar rastro.
  const { requeued: remindersRequeued } = await step
    .run('reconcile-reminders', async () => reconcileOverdueReminders())
    .catch((err) => {
      console.error('[task-daily-sweep] reconciliación de recordatorios falló', err);
      return { requeued: 0 };
    });

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

  return { tenants: tenantIds.length, pendingTreatment, inactive, failed, remindersRequeued };
}
