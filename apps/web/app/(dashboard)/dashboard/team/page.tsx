import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { getCurrentTenant } from '@/lib/tenant';
import { clerkClient } from '@clerk/nextjs/server';
import { InviteMember } from './invite-member';

const roleMap: Record<string, { label: string; tone: 'violet' | 'info' | 'neutral' }> = {
  'org:admin': { label: 'Admin', tone: 'violet' },
  admin: { label: 'Admin', tone: 'violet' },
  'org:member': { label: 'Operador', tone: 'info' },
  basic_member: { label: 'Operador', tone: 'info' },
  member: { label: 'Operador', tone: 'info' },
  viewer: { label: 'Lector', tone: 'neutral' },
};

function initials(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default async function TeamPage() {
  const { tenant, impersonating } = await getCurrentTenant();
  const orgId = tenant.clerkOrganizationId;
  if (!orgId) {
    return (
      <Card>
        <div className="p-10 text-center text-sm text-zinc-500">
          Necesitás una organización activa para ver al equipo.
        </div>
      </Card>
    );
  }

  const cc = await clerkClient();
  // La org de Clerk de la clínica puede no existir/ser inválida (ej. tenant de
  // prueba, o clínica sin org real). No debemos romper la página: si Clerk
  // falla, mostramos un estado vacío en vez de un 500.
  const [memberships, invitations] = await (async () => {
    try {
      return [
        await cc.organizations.getOrganizationMembershipList({ organizationId: orgId, limit: 50 }),
        await cc.organizations.getOrganizationInvitationList({
          organizationId: orgId,
          status: ['pending'],
          limit: 50,
        }),
      ] as const;
    } catch {
      return [null, null] as const;
    }
  })();

  if (!memberships || !invitations) {
    return (
      <>
        <PageHeader title="Equipo" description="Personas con acceso al panel." />
        <Card>
          <div className="p-10 text-center text-sm text-zinc-500">
            No se pudo cargar el equipo de esta clínica.
            {impersonating
              ? ' La gestión del equipo se hace desde la cuenta de la clínica.'
              : ''}
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Equipo" description="Personas con acceso al panel." />

      {impersonating ? (
        <div className="mb-5 rounded-2xl border border-violet-200/70 bg-violet-50/60 p-4 text-sm text-zinc-600">
          En modo Futura no podés invitar miembros de esta clínica. La gestión del equipo se hace
          desde la cuenta de la clínica.
        </div>
      ) : (
        <div className="mb-5">
          <InviteMember />
        </div>
      )}

      <Card>
        <div className="divide-y divide-[--color-border-subtle]">
          {memberships.data.length === 0 && invitations.data.length === 0 ? (
            <div className="p-10 text-center text-sm text-zinc-500">
              Aún no hay miembros. Usá “Invitar miembro” para sumar a tu equipo.
            </div>
          ) : null}

          {memberships.data.map((m) => {
            const userName =
              [m.publicUserData?.firstName, m.publicUserData?.lastName].filter(Boolean).join(' ') ||
              m.publicUserData?.identifier ||
              'Miembro';
            const email = m.publicUserData?.identifier ?? '';
            const role = roleMap[m.role] ?? { label: m.role, tone: 'neutral' as const };

            return (
              <div key={m.id} className="flex items-center justify-between gap-3 p-4 sm:p-5">
                <div className="flex items-center gap-3 min-w-0">
                  {m.publicUserData?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.publicUserData.imageUrl}
                      alt={userName}
                      className="h-9 w-9 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <div className="h-9 w-9 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 text-white flex items-center justify-center text-sm font-semibold shrink-0">
                      {initials(userName)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-medium truncate">{userName}</p>
                    <p className="text-xs text-zinc-500 truncate">{email}</p>
                  </div>
                </div>
                <Badge tone={role.tone} className="shrink-0">
                  {role.label}
                </Badge>
              </div>
            );
          })}

          {invitations.data.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-3 p-4 sm:p-5">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-9 w-9 rounded-full bg-zinc-100 text-zinc-500 flex items-center justify-center text-sm font-semibold shrink-0">
                  {initials(inv.emailAddress)}
                </div>
                <div className="min-w-0">
                  <p className="font-medium truncate">{inv.emailAddress}</p>
                  <p className="text-xs text-zinc-500 truncate">
                    Invitación enviada · {new Date(inv.createdAt).toLocaleDateString('es-ES')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-3 shrink-0 flex-wrap justify-end">
                <Badge tone="warn">Pendiente</Badge>
                <Badge tone={(roleMap[inv.role] ?? { tone: 'neutral' as const }).tone}>
                  {(roleMap[inv.role] ?? { label: inv.role }).label}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
