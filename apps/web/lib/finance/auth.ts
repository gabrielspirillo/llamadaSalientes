import 'server-only';

import { type TaskAuthContext, TaskForbiddenError, requireTaskRole } from '@/lib/tasks/auth';

/**
 * Quién puede qué en Finanzas.
 *
 *   - `admin` (la dueña, y Futura): lo ve todo. El resumen de salud del
 *     negocio, los ajustes y borrar movimientos son sólo suyos: son las
 *     cuentas de la clínica.
 *   - `operator` (recepción): carga gastos y comprobantes y ve el libro.
 *     Es quien tiene el ticket en la mano.
 *   - `viewer` y un profesional con acceso restringido: nada. El gate de
 *     `requireTaskRole` ya rechaza al restringido.
 */
export class FinanceForbiddenError extends Error {
  constructor(message = 'No tienes permiso para esta acción de finanzas.') {
    super(message);
    this.name = 'FinanceForbiddenError';
  }
}

export interface FinanceAccess extends TaskAuthContext {
  /** Resumen, ajustes, borrar. */
  canManage: boolean;
  /** Registrar movimientos y adjuntar comprobantes. */
  canWrite: boolean;
}

export async function getFinanceAccess(): Promise<FinanceAccess> {
  let ctx: TaskAuthContext;
  try {
    ctx = await requireTaskRole('operator');
  } catch (err) {
    if (err instanceof TaskForbiddenError) {
      throw new FinanceForbiddenError('Tu rol no tiene acceso a Finanzas.');
    }
    throw err;
  }
  return { ...ctx, canManage: ctx.role === 'admin', canWrite: true };
}

/** Cargar gastos y comprobantes: recepción o más. */
export async function requireFinanceWriter(): Promise<FinanceAccess> {
  return getFinanceAccess();
}

/** Resumen, ajustes y borrados: sólo el administrador de la clínica o Futura. */
export async function requireFinanceManager(): Promise<FinanceAccess> {
  const ctx = await getFinanceAccess();
  if (!ctx.canManage) {
    throw new FinanceForbiddenError('Sólo un administrador puede hacer esto en Finanzas.');
  }
  return ctx;
}
