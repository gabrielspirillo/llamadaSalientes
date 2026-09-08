import 'server-only';
import { eq } from 'drizzle-orm';
import { cache } from 'react';

import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';

/**
 * `users.id` interno a partir del id de Clerk.
 *
 * Cacheado por request con `cache()` de React: el layout del panel lo pide
 * para los badges y después la página de Tareas o la de Mensajes lo vuelve a
 * pedir en el MISMO render. Estaba además duplicado en dos módulos, así que
 * eran dos round-trips a Postgres en cada navegación a esas secciones.
 *
 * Devuelve null si el webhook de Clerk todavía no sincronizó al usuario.
 */
export const internalUserIdFor = cache(async (clerkUserId: string): Promise<string | null> => {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);
  return row?.id ?? null;
});

/**
 * Como `internalUserIdFor`, pero crea la fila si falta.
 *
 * La necesita Futura cuando gestiona una clínica: no es miembro de esa clínica
 * y, si además el webhook de Clerk nunca la sincronizó, no tiene `users.id`
 * con el que firmar lo que escribe (creadora de una tarea, autora de una
 * nota). El email sale de Clerk, que es la fuente de verdad; el insert es
 * idempotente por `clerk_user_id` para que dos peticiones a la vez no choquen.
 *
 * Clerk se importa aquí dentro y no arriba: este módulo lo arrastran
 * `lib/tasks/queries` y `lib/messaging/queries`, y un import de
 * `@clerk/nextjs/server` en la cabecera lo metería también en el worker.
 */
export async function ensureInternalUserId(clerkUserId: string): Promise<string> {
  const existing = await internalUserIdFor(clerkUserId);
  if (existing) return existing;

  const { clerkClient } = await import('@clerk/nextjs/server');
  const user = await (await clerkClient()).users.getUser(clerkUserId);
  const email =
    user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
  if (!email) {
    throw new Error(`El usuario ${clerkUserId} no tiene email en Clerk; no se puede sincronizar`);
  }

  await db
    .insert(users)
    .values({ clerkUserId, email })
    .onConflictDoNothing({ target: users.clerkUserId });

  // No se reutiliza `internalUserIdFor`: está cacheado por request y acaba de
  // devolver null.
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);
  if (!row) throw new Error(`No se pudo crear el usuario interno de ${clerkUserId}`);
  return row.id;
}
