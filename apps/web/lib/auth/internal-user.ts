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
