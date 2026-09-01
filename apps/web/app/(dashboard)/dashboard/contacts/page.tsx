import { ContactsGrid } from '@/components/dashboard/contacts-grid';
import { PageHeader } from '@/components/dashboard/page-header';
import { Card } from '@/components/ui/card';
import { listContacts } from '@/lib/ghl/contacts';
import { getCurrentTenant } from '@/lib/tenant';
import { getGhlIntegration } from '@/lib/data/ghl-integration';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ContactsPage() {
  const { tenant } = await getCurrentTenant();
  const integration = await getGhlIntegration(tenant.id);

  if (!integration) {
    return (
      <>
        <PageHeader
          title="Contactos"
          description="Pacientes registrados en tu CRM."
        />
        <Card>
          <div className="px-6 py-16 text-center max-w-md mx-auto">
            <p className="text-base font-semibold tracking-tight">
              Conectá GoHighLevel primero
            </p>
            <p className="text-sm text-zinc-500 mt-1.5">
              Para ver tus contactos necesitamos la integración con GHL configurada.
            </p>
            <Link
              href="/dashboard/configuration?tab=integrations"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-[linear-gradient(120deg,#7139e8,#8b5cf6)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_-10px_rgba(113,57,232,0.75)] transition-all duration-300 hover:-translate-y-0.5"
            >
              Ir a configuración
            </Link>
          </div>
        </Card>
      </>
    );
  }

  const { contacts, total } = await listContacts(tenant.id, { limit: 50 });

  return (
    <>
      <PageHeader
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
