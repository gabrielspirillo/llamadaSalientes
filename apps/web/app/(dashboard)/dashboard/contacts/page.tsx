import { ContactsGrid } from '@/components/dashboard/contacts-grid';
import { PageHeader } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { getGhlIntegration } from '@/lib/data/ghl-integration';
import { listContacts } from '@/lib/ghl/contacts';
import { getCurrentTenant } from '@/lib/tenant';
import { Contact, PlugZap } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ContactsPage() {
  const { tenant } = await getCurrentTenant();
  const integration = await getGhlIntegration(tenant.id);

  // Sin CRM, esta pantalla decía "conecta GoHighLevel primero" y ahí acababa
  // todo, como si la clínica no tuviera pacientes. Los tiene: los que ha dado
  // de alta el asistente y los que han pasado por consulta viven en la
  // plataforma, con su historia clínica, en la ficha de pacientes de Agenda.
  if (!integration) {
    return (
      <>
        <PageHeader
          eyebrow="Clínica"
          title="Pacientes"
          description="Los pacientes de la clínica, con su historia clínica, viven en la plataforma."
          icon={<Contact className="h-5 w-5" />}
        />
        <Card>
          <EmptyState
            icon={<Contact className="h-5 w-5" />}
            title="Tus pacientes están en Agenda"
            description="Quién ha pasado por consulta, cuándo vuelve, sus notas y los que ha dado de alta el asistente. Esta pantalla es sólo el listado del CRM externo, que no hace falta para trabajar."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button asChild size="sm">
                  <Link href="/dashboard/agenda/pacientes">Ver mis pacientes</Link>
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link href="/dashboard/configuration?tab=integrations">
                    <PlugZap className="h-4 w-4" /> Conectar un CRM
                  </Link>
                </Button>
              </div>
            }
          />
        </Card>
      </>
    );
  }

  const { contacts, total } = await listContacts(tenant.id, { limit: 50 });

  return (
    <>
      <PageHeader
        eyebrow="CRM"
        icon={<Contact className="h-5 w-5" />}
        title="Pacientes"
        description={
          total > 0
            ? `${total.toLocaleString('es-ES')} pacientes registrados en tu CRM`
            : 'Pacientes registrados en tu CRM'
        }
      />
      <ContactsGrid initial={contacts} />
    </>
  );
}
