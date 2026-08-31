import 'server-only';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';

// Cookie que marca "Futura está actuando como la clínica X". SOLO se respeta si
// el usuario real es super-admin (se re-valida en cada request en
// getCurrentTenant); si no, se ignora por completo. La setea/limpia únicamente
// una acción gateada (ver futura/impersonation-actions.ts).
export const IMPERSONATION_COOKIE = 'futura_acting_tenant';

export async function getActingTenantId(): Promise<string | null> {
  try {
    const store = await cookies();
    return store.get(IMPERSONATION_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findTenantById(id: string) {
  // La cookie es texto arbitrario editable por el usuario; validamos el formato
  // UUID antes de la query para no reventar Postgres (22P02) y tumbar el
  // dashboard. Cualquier valor inválido o error → null (se ignora la cookie).
  if (!UUID_RE.test(id)) return null;
  try {
    const rows = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
