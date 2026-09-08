import 'server-only';
import { and, eq, isNotNull } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { professionals, users } from '@/lib/db/schema';
import { listTenantMembersSynced } from '@/lib/tenant-members';
import { clerkClient } from '@clerk/nextjs/server';

/**
 * Gente del equipo que puede darse de alta como profesional.
 *
 * Dar de alta a la Dra. Ruiz tecleando otra vez su nombre y su email —que ya
 * están en Clerk porque se la invitó al panel— es trabajo duplicado y una
 * fuente de erratas: basta un acento distinto para que el vínculo con su
 * usuario no se haga y acabe sin ver su propia agenda.
 */
export interface TeamCandidate {
  clerkUserId: string;
  email: string;
  fullName: string;
  phone: string | null;
  imageUrl: string | null;
  role: string;
  /** Ya tiene ficha de profesional en esta clínica. */
  alreadyProfessional: boolean;
  professionalName: string | null;
}

interface MemberLike {
  clerkUserId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
}

interface ClerkUserLike {
  id: string;
  imageUrl?: string | null;
  primaryPhoneNumberId?: string | null;
  phoneNumbers?: { id: string; phoneNumber: string }[];
}

/**
 * Cruza lo que sabe la app con lo que sabe Clerk. Puro: se testea sin red.
 *
 * El nombre sale de Clerk cuando lo tiene; si no, se deduce del email, que es
 * mejor que dejar el campo vacío y obligar a teclearlo.
 */
export function buildTeamCandidates(input: {
  members: MemberLike[];
  clerkUsers: ClerkUserLike[];
  professionalsByClerkUserId: Map<string, string>;
}): TeamCandidate[] {
  const byId = new Map(input.clerkUsers.map((u) => [u.id, u]));

  return input.members
    .map((m) => {
      const clerkUser = byId.get(m.clerkUserId);
      const nombre = [m.firstName, m.lastName].filter(Boolean).join(' ').trim();
      const professionalName = input.professionalsByClerkUserId.get(m.clerkUserId) ?? null;

      return {
        clerkUserId: m.clerkUserId,
        email: m.email,
        fullName: nombre || nombreDesdeEmail(m.email),
        phone: telefonoPrincipal(clerkUser),
        imageUrl: clerkUser?.imageUrl ?? null,
        role: m.role,
        alreadyProfessional: professionalName !== null,
        professionalName,
      };
    })
    .sort((a, b) => {
      // Los que aún no son profesionales van primero: son los que se van a elegir.
      if (a.alreadyProfessional !== b.alreadyProfessional) return a.alreadyProfessional ? 1 : -1;
      return a.fullName.localeCompare(b.fullName, 'es');
    });
}

function telefonoPrincipal(user: ClerkUserLike | undefined): string | null {
  if (!user?.phoneNumbers || user.phoneNumbers.length === 0) return null;
  const principal = user.primaryPhoneNumberId
    ? user.phoneNumbers.find((p) => p.id === user.primaryPhoneNumberId)
    : null;
  return (principal ?? user.phoneNumbers[0])?.phoneNumber ?? null;
}

/** "marta.ruiz@clinica.test" → "Marta Ruiz". */
export function nombreDesdeEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ') || email
  );
}

/**
 * Miembros del equipo con lo que hace falta para rellenar el alta.
 *
 * Clerk es la fuente de verdad (`listTenantMembersSynced` ya sincroniza de
 * paso `users` y `tenant_memberships`, que es justo lo que hace falta para
 * poder vincular al profesional con su usuario). El teléfono no viene en el
 * listado de miembros, así que se pide aparte en UNA llamada para todos.
 */
export async function listTeamCandidates(
  tenantId: string,
  clerkOrganizationId: string,
): Promise<TeamCandidate[]> {
  const members = await listTenantMembersSynced(tenantId, clerkOrganizationId);
  if (members.length === 0) return [];

  const clerkIds = members.map((m) => m.clerkUserId);

  const [clerkUsers, yaProfesionales] = await Promise.all([
    (async () => {
      try {
        const cc = await clerkClient();
        const res = await cc.users.getUserList({ userId: clerkIds, limit: 100 });
        return res.data as unknown as ClerkUserLike[];
      } catch (err) {
        // Sin teléfono ni foto se puede seguir: el resto de datos ya los tenemos.
        console.warn('[agenda-team] no se pudieron leer los usuarios de Clerk', {
          err: (err as Error).message,
        });
        return [] as ClerkUserLike[];
      }
    })(),
    db
      .select({ clerkUserId: users.clerkUserId, fullName: professionals.fullName })
      .from(professionals)
      .innerJoin(users, eq(users.id, professionals.userId))
      .where(and(eq(professionals.tenantId, tenantId), isNotNull(professionals.userId))),
  ]);

  return buildTeamCandidates({
    members,
    clerkUsers,
    professionalsByClerkUserId: new Map(yaProfesionales.map((p) => [p.clerkUserId, p.fullName])),
  });
}
