import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { mockTeam } from '@/lib/mock-data';
import { MoreHorizontal, UserPlus } from 'lucide-react';

const roleMap = {
  admin: { label: 'Admin', tone: 'violet' as const },
  operator: { label: 'Operador', tone: 'info' as const },
  viewer: { label: 'Lector', tone: 'neutral' as const },
};

type Role = keyof typeof roleMap;

export default function TeamPage() {
  return (
    <>
      <PageHeader
        title="Equipo"
        description="Personas con acceso al panel de Clínica Demo."
        actions={
          <Button size="sm">
            <UserPlus className="h-4 w-4" /> Invitar miembro
          </Button>
        }
      />

      <Card>
        <div className="divide-y divide-zinc-100">
          {mockTeam.map((m) => (
            <div key={m.id} className="flex items-center justify-between p-5">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 text-white flex items-center justify-center text-sm font-semibold">
                  {m.name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .slice(0, 2)}
                </div>
                <div>
                  <p className="font-medium">{m.name}</p>
                  <p className="text-xs text-zinc-500">{m.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {m.status === 'invited' && <Badge tone="warn">Invitación pendiente</Badge>}
                <Badge tone={roleMap[m.role as Role].tone}>{roleMap[m.role as Role].label}</Badge>
                <Button variant="ghost" size="icon">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
