import 'server-only';
import { and, eq, lt } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { appointmentReminders } from '@/lib/db/schema';
import { sendQueueEvent } from '@/lib/queue/client';

/**
 * Re-encola los recordatorios que ya deberían haberse enviado y siguen en
 * SCHEDULED.
 *
 * Los `reminder-send` son jobs *delayed*: viven sólo en Redis. Los repeatables
 * se vuelven a registrar al arrancar el worker, pero los delayed no, así que
 * un reinicio de Redis sin persistencia (o un FLUSHALL) borra en silencio
 * todos los recordatorios programados y nadie se entera hasta que un paciente
 * no aparece. Esta reconciliación es la red que faltaba.
 *
 * Es segura de repetir: `sendQueueEvent` usa un jobId estable por reminderId,
 * así que re-encolar uno ya encolado es un no-op, y el handler vuelve a
 * comprobar `status === 'SCHEDULED'` antes de enviar nada.
 *
 * El margen de gracia evita pelearse con los jobs que están a punto de
 * ejecutarse por su propio delay.
 */
const GRACE_MINUTES = 10;
const MAX_PER_RUN = 500;

export async function reconcileOverdueReminders(): Promise<{ requeued: number }> {
  const cutoff = new Date(Date.now() - GRACE_MINUTES * 60 * 1000);

  const overdue = await db
    .select({
      id: appointmentReminders.id,
      tenantId: appointmentReminders.tenantId,
    })
    .from(appointmentReminders)
    .where(
      and(
        eq(appointmentReminders.status, 'SCHEDULED'),
        lt(appointmentReminders.scheduledFor, cutoff),
      ),
    )
    .limit(MAX_PER_RUN);

  let requeued = 0;
  for (const rem of overdue) {
    try {
      await sendQueueEvent('reminder-send', { tenantId: rem.tenantId, reminderId: rem.id });
      requeued += 1;
    } catch (err) {
      console.warn('[reminders] no se pudo re-encolar', {
        reminderId: rem.id,
        err: (err as Error).message,
      });
    }
  }

  if (requeued > 0) {
    console.warn(
      '[reminders] %d recordatorios vencidos re-encolados. Si el número no es cero de forma habitual, revisá la persistencia de Redis.',
      requeued,
    );
  }

  return { requeued };
}
