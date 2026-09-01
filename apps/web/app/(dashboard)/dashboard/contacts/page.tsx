import { ContactsGrid } from '@/components/dashboard/contacts-grid';
import { PageHeader } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { listContacts } from '@/lib/ghl/contacts';
import { getCurrentTenant } from '@/lib/tenant';
import { getGhlIntegration } from '@/lib/data/ghl-integration';
import { Contact, PlugZap } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ContactsPage() {
  const { tenant } = await getCurrentTenant();
  const integration = await getGhlIntegration(tenant.id);

  if (!integration) {
    return (
      <>
        <PageHeader
          eyebrow="CRM"
          title="Contactos"
          description="Pacientes registrados en tu CRM."
          icon={<Contact className="h-5 w-5" />}
        />
        <Card>
          <EmptyState
            icon={<PlugZap className="h-5 w-5" />}
            title="Conectá GoHighLevel primero"
            description="Para ver tus contactos necesitamos la integración con GHL configurada."
            action={
              <Button asChild size="sm">
                <Link href="/dashboard/configuration?tab=integrations">Ir a configuración</Link>
              </Button>
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
        title="Contactos"
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
