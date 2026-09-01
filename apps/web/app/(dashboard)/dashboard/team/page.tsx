import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Callout, EmptyState } from '@/components/ui/feedback';
import { Avatar } from '@/components/ui/stat';
import { getCurrentTenant } from '@/lib/tenant';
import { clerkClient } from '@clerk/nextjs/server';
import { Info, MailPlus, Users } from 'lucide-react';
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
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title="Sin organización activa"
          description="Necesitas una organización activa para ver el equipo."
        />
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
        <PageHeader
          eyebrow="Accesos"
          icon={<Users className="h-5 w-5" />}
          title="Equipo"
          description="Personas con acceso al panel."
        />
        <Card>
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="No se pudo cargar el equipo"
            description={
              impersonating
                ? 'La gestión del equipo se hace desde la cuenta de la clínica.'
                : 'Vuelve a intentarlo en unos segundos.'
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Accesos"
        icon={<Users className="h-5 w-5" />}
        title="Equipo"
        description="Personas con acceso al panel de tu clínica."
      />

      {impersonating ? (
        <Callout tone="brand" icon={<Info className="h-4 w-4" />} className="mb-5">
          En modo Futura no puedes invitar a miembros de esta clínica. El equipo se gestiona desde
          la cuenta de la propia clínica.
        </Callout>
      ) : (
        <div className="mb-5">
          <InviteMember />
        </div>
      )}

      <Card>
        <div className="divide-y divide-[--color-border-subtle]">
          {memberships.data.length === 0 && invitations.data.length === 0 ? (
            <EmptyState
              icon={<MailPlus className="h-5 w-5" />}
              title="Aún no hay miembros"
              description="Usa “Invitar miembro” para dar acceso al panel a tu equipo."
            />
          ) : null}

          {memberships.data.map((m) => {
            const userName =
              [m.publicUserData?.firstName, m.publicUserData?.lastName].filter(Boolean).join(' ') ||
              m.publicUserData?.identifier ||
              'Miembro';
            const email = m.publicUserData?.identifier ?? '';
            const role = roleMap[m.role] ?? { label: m.role, tone: 'neutral' as const };

            return (
              <div
                key={m.id}
                className="flex items-center justify-between gap-3 p-4 transition-colors duration-200 hover:bg-zinc-50 sm:p-5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={userName} src={m.publicUserData?.imageUrl} size={40} />
                  <div className="min-w-0">
                    <p className="truncate text-[17px] font-bold text-zinc-900">{userName}</p>
                    <p className="truncate text-[14px] text-zinc-500">{email}</p>
                  </div>
                </div>
                <Badge tone={role.tone} className="shrink-0">
                  {role.label}
                </Badge>
              </div>
            );
          })}

          {invitations.data.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center justify-between gap-3 p-4 transition-colors duration-200 hover:bg-zinc-50 sm:p-5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[16px] font-bold text-zinc-400 ring-2 ring-white">
                  {initials(inv.emailAddress)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[17px] font-bold text-zinc-900">{inv.emailAddress}</p>
                  <p className="truncate text-[14px] text-zinc-500">
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
