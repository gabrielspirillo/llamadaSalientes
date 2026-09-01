import { NextResponse } from 'next/server';

import { taskErrorResponse } from '@/lib/tasks/api';
import { requireTaskRole } from '@/lib/tasks/auth';
import { materializeRoutinesForTenant, runDailySweepsForTenant } from '@/lib/tasks/materialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Fuerza la generación de rutinas y los barridos diarios sin esperar al worker.
 * Útil el día que la clínica activa el módulo: el tablero se llena al momento.
 */
export async function POST(): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('admin');
    const routines = await materializeRoutinesForTenant(auth.tenantId);
    const sweeps = await runDailySweepsForTenant(auth.tenantId);
    return NextResponse.json({ routines, sweeps });
  } catch (err) {
    return taskErrorResponse(err);
  }
}
