import { ContactsGrid } from '@/components/dashboard/contacts-grid';
import { PageHeader } from '@/components/dashboard/page-header';
import { getGhlIntegration } from '@/lib/data/ghl-integration';
import { listContacts } from '@/lib/ghl/contacts';
import { getCurrentTenant } from '@/lib/tenant';
import { Contact } from 'lucide-react';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ContactsPage() {
  const { tenant } = await getCurrentTenant();
  const integration = await getGhlIntegration(tenant.id);

  // Sin CRM esta pantalla no tiene nada que listar: los pacientes de la
  // clínica viven en la plataforma, en Agenda → Pacientes. Tener dos entradas
  // "Pacientes" y que una salga vacía confundía; se va directo a la que tiene
  // los datos.
  if (!integration) {
    redirect('/dashboard/agenda/pacientes');
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
