import 'server-only';

import type { StepRunner } from '@/lib/queue/step';
import { listActiveTenantIds, materializeRoutinesForTenant } from '@/lib/tasks/materialize';

/**
 * Tick de rutinas: recorre las clínicas activas y materializa lo que toque hoy
 * en la timezone de cada una.
 *
 * Corre cada 15 minutos. Es barato porque `last_materialized_on` corta el
 * trabajo: una clínica ya procesada hoy sale en una query por plantilla.
 *
 * Un tenant que falla no frena a los demás — el objetivo es que la clínica de
 * al lado tenga su checklist de apertura aunque una integración esté rota.
 */
export async function processTaskRoutinesTickJob(
  _data: Record<string, never>,
  step: StepRunner,
): Promise<{ tenants: number; created: number; failed: number }> {
  const tenantIds = await step.run('list-tenants', async () => listActiveTenantIds());

  let created = 0;
  let failed = 0;

  for (const tenantId of tenantIds) {
    try {
      const res = await materializeRoutinesForTenant(tenantId);
      created += res.created;
    } catch (err) {
      failed += 1;
      console.error('[task-routines-tick] tenant failed', {
        tenantId,
        err: (err as Error).message,
      });
    }
  }

  return { tenants: tenantIds.length, created, failed };
}
