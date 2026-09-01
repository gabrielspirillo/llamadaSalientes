import 'server-only';
import { NextResponse } from 'next/server';

import { TaskForbiddenError, type TaskRole, requireTaskRole } from '@/lib/tasks/auth';

/**
 * Gate de rol para route handlers.
 *
 * Buena parte de la superficie sólo comprobaba "hay sesión + hay tenant", de
 * modo que un `viewer` podía reescribir credenciales del proveedor telefónico,
 * desviar las llamadas entrantes de la clínica a otro número o lanzar campañas
 * salientes. Esconder el botón en la UI no protege un endpoint POST.
 *
 * Devuelve la respuesta de error, o `null` si el usuario pasa el gate.
 */
export async function denyUnlessRole(min: TaskRole): Promise<NextResponse | null> {
  try {
    await requireTaskRole(min);
    return null;
  } catch (err) {
    if (err instanceof TaskForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
