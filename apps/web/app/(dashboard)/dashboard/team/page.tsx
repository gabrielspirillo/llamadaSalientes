import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getCurrentTenant } from '@/lib/tenant';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { UserPlus } from 'lucide-react';

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
  await getCurrentTenant(); // garantiza sesión + tenant
  const { orgId } = await auth();
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
  const memberships = await cc.organizations.getOrganizationMembershipList({
    organizationId: orgId,
    limit: 50,
  });
  const invitations = await cc.organizations.getOrganizationInvitationList({
    organizationId: orgId,
    status: ['pending'],
    limit: 50,
  });

  return (
    <>
      <PageHeader
        title="Equipo"
        description="Personas con acceso al panel."
        actions={
          <Button asChild size="sm">
            <a
              href={`https://dashboard.clerk.com/apps`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2"
            >
              <UserPlus className="h-4 w-4" /> Invitar miembro
            </a>
          </Button>
        }
      />

      <Card>
        <div className="divide-y divide-zinc-100">
          {memberships.data.length === 0 && invitations.data.length === 0 ? (
            <div className="p-10 text-center text-sm text-zinc-500">
              Aún no hay miembros. Invitá a tu equipo desde Clerk.
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
              <div key={m.id} className="flex items-center justify-between p-5">
                <div className="flex items-center gap-3">
                  {m.publicUserData?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.publicUserData.imageUrl}
                      alt={userName}
                      className="h-9 w-9 rounded-full object-cover"
                    />
                  ) : (
                    <div className="h-9 w-9 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 text-white flex items-center justify-center text-sm font-semibold">
                      {initials(userName)}
                    </div>
                  )}
                  <div>
                    <p className="font-medium">{userName}</p>
                    <p className="text-xs text-zinc-500">{email}</p>
                  </div>
                </div>
                <Badge tone={role.tone}>{role.label}</Badge>
              </div>
            );
          })}

          {invitations.data.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between p-5">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-zinc-100 text-zinc-500 flex items-center justify-center text-sm font-semibold">
                  {initials(inv.emailAddress)}
                </div>
                <div>
                  <p className="font-medium">{inv.emailAddress}</p>
                  <p className="text-xs text-zinc-500">
                    Invitación enviada · {new Date(inv.createdAt).toLocaleDateString('es-ES')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
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
