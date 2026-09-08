import 'server-only';
import { and, eq } from 'drizzle-orm';

import {
  type ProfessionalLink,
  findProfessionalForClerkUser,
  isAgendaOnly,
} from '@/lib/agenda/access';
import { type TenantRole, normalizeRole, resolveTenantRole } from '@/lib/auth/tenant-role';
import { db } from '@/lib/db/client';
import { professionals } from '@/lib/db/schema';
import { auth } from '@clerk/nextjs/server';

export class AgendaForbiddenError extends Error {
  constructor(message = 'No tienes permiso para esta acción de agenda.') {
    super(message);
    this.name = 'AgendaForbiddenError';
  }
}

export interface AgendaContext {
  tenantId: string;
  clerkOrganizationId: string;
  /** users.id interno — el que referencian las citas y las notas. */
  userId: string | null;
  clerkUserId: string;
  role: TenantRole;
  isSuperAdmin: boolean;
  impersonating: boolean;
  /** Ficha de profesional del usuario, si la tiene. */
  professional: ProfessionalLink | null;
  /** ALL = ve todas las agendas; OWN = sólo la suya. */
  scope: 'ALL' | 'OWN';
  /** Alta/baja de profesionales, horarios y tratamientos: admin o Futura. */
  canManageProfessionals: boolean;
  /** Crear, mover y cancelar citas. */
  canWriteAppointments: boolean;
  /** Escribir historia clínica. */
  canWriteClinicalNotes: boolean;
  /** El panel se le queda reducido a la agenda. */
  agendaOnly: boolean;
}

/**
 * Contexto de la agenda para el usuario logueado.
 *
 * Reglas, en una línea:
 *   - Futura y el admin de la clínica lo pueden todo (Futura, además, sobre
 *     cualquier clínica: entra impersonando y `getCurrentTenant` ya devuelve la
 *     clínica gestionada).
 *   - Recepción (`operator`) ve todas las agendas y agenda citas, pero no toca
 *     la configuración de los profesionales.
 *   - Un `viewer` mira.
 *   - Un profesional con acceso restringido ve SU agenda y SUS pacientes, y
 *     escribe la historia clínica de lo que atiende.
 */
export async function getAgendaContext(): Promise<AgendaContext> {
  const [ctx, session] = await Promise.all([resolveTenantRole(), auth()]);

  // El rol sale de `resolveTenantRole()` (Futura = admin en cualquier clínica;
  // el resto, su fila de `tenant_memberships`) y, si no hay fila, del rol de
  // la organización de Clerk. La tabla local es una caché que llena un
  // webhook: si ese webhook no corrió (clínica creada antes, endpoint mal
  // configurado), el administrador se quedaba degradado a operador y no podía
  // configurar ni su propia agenda. Clerk es la fuente de verdad de los roles.
  const role: TenantRole = ctx.role ?? normalizeRole(session.orgRole);
  const professional = await findProfessionalForClerkUser(ctx.tenantId, ctx.clerkUserId);
  const agendaOnly = isAgendaOnly(professional, { role, isSuperAdmin: ctx.isSuperAdmin });

  const canManageProfessionals = role === 'admin' || ctx.isSuperAdmin;
  const canWriteAppointments =
    canManageProfessionals || role === 'operator' || (agendaOnly && Boolean(professional));
  const canWriteClinicalNotes = canWriteAppointments;

  return {
    tenantId: ctx.tenantId,
    clerkOrganizationId: ctx.clerkOrganizationId,
    userId: ctx.internalUserId,
    clerkUserId: ctx.clerkUserId,
    role,
    isSuperAdmin: ctx.isSuperAdmin,
    impersonating: ctx.impersonating,
    professional,
    scope: agendaOnly ? 'OWN' : 'ALL',
    canManageProfessionals,
    canWriteAppointments,
    canWriteClinicalNotes,
    agendaOnly,
  };
}

/** Como `getAgendaContext`, pero revienta si el usuario no puede escribir. */
export async function requireAgendaWriter(): Promise<AgendaContext> {
  const ctx = await getAgendaContext();
  if (!ctx.canWriteAppointments) {
    throw new AgendaForbiddenError('Tu rol sólo permite consultar la agenda.');
  }
  return ctx;
}

/** Configuración de profesionales: sólo admin de la clínica o Futura. */
export async function requireAgendaManager(): Promise<AgendaContext> {
  const ctx = await getAgendaContext();
  if (!ctx.canManageProfessionals) {
    throw new AgendaForbiddenError(
      'Sólo un administrador de la clínica puede configurar las agendas.',
    );
  }
  return ctx;
}

/**
 * Comprueba que el usuario puede tocar la agenda de ESE profesional, y de paso
 * que el profesional es de este tenant.
 *
 * El id llega del cliente en todas las escrituras, así que se valida contra la
 * base y no contra lo que venga en el body: sin este chequeo un profesional
 * podría escribir en la agenda del de al lado mandando otro id.
 */
export async function assertProfessionalInScope(
  ctx: AgendaContext,
  professionalId: string,
): Promise<void> {
  if (ctx.scope === 'OWN' && ctx.professional?.id !== professionalId) {
    throw new AgendaForbiddenError('Sólo puedes operar sobre tu propia agenda.');
  }

  const rows = await db
    .select({ id: professionals.id })
    .from(professionals)
    .where(and(eq(professionals.tenantId, ctx.tenantId), eq(professionals.id, professionalId)))
    .limit(1);

  if (rows.length === 0) {
    throw new AgendaForbiddenError('Ese profesional no existe en esta clínica.');
  }
}
