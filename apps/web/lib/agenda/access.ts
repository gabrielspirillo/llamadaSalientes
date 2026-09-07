import 'server-only';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { professionals, users } from '@/lib/db/schema';

/**
 * Vínculo entre un usuario de la plataforma y su ficha de profesional.
 *
 * Vive en su propio módulo (y no en `lib/agenda/auth.ts`) porque lo necesitan
 * dos sitios que no pueden importarse entre sí sin ciclo: la propia agenda y
 * `lib/tasks/auth.ts`, que es el gate de rol del resto del panel.
 */
export interface ProfessionalLink {
  id: string;
  fullName: string;
  panelAccess: 'AGENDA_ONLY' | 'FULL';
  agendaEnabled: boolean;
  active: boolean;
  color: string;
}

/**
 * Ficha de profesional del usuario logueado en este tenant, o null si no es
 * profesional. La búsqueda lleva `tenant_id` en el WHERE aunque el `user_id`
 * ya sea único: el mismo usuario puede ser profesional en dos clínicas.
 */
export async function findProfessionalForClerkUser(
  tenantId: string,
  clerkUserId: string,
): Promise<ProfessionalLink | null> {
  const rows = await db
    .select({
      id: professionals.id,
      fullName: professionals.fullName,
      panelAccess: professionals.panelAccess,
      agendaEnabled: professionals.agendaEnabled,
      active: professionals.active,
      color: professionals.color,
    })
    .from(professionals)
    .innerJoin(users, eq(users.id, professionals.userId))
    .where(and(eq(professionals.tenantId, tenantId), eq(users.clerkUserId, clerkUserId)))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * ¿Este usuario sólo puede ver su agenda?
 *
 * Un profesional con `panel_access = 'AGENDA_ONLY'` ve su agenda, sus pacientes
 * y sus notas, y nada más. La restricción NO se aplica a un admin de la clínica
 * ni a Futura: el dueño que además pasa consulta se quedaría fuera de su propio
 * panel. Por eso el rol se pasa desde fuera y no se vuelve a consultar aquí.
 */
export function isAgendaOnly(
  link: ProfessionalLink | null,
  opts: { role: string; isSuperAdmin: boolean },
): boolean {
  if (!link) return false;
  if (opts.isSuperAdmin) return false;
  if (opts.role === 'admin') return false;
  return link.panelAccess === 'AGENDA_ONLY';
}

/** Prefijos de ruta que un profesional restringido SÍ puede abrir. */
export const AGENDA_ONLY_ALLOWED_PREFIXES = ['/dashboard/agenda'] as const;

export function isAgendaOnlyAllowedPath(pathname: string): boolean {
  if (pathname === '/dashboard/agenda') return true;
  return AGENDA_ONLY_ALLOWED_PREFIXES.some((p) => pathname.startsWith(`${p}/`));
}
