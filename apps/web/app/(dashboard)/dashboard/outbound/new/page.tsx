import { OutboundCampaignForm } from '@/components/dashboard/outbound-campaign-form';
import { PageHeader } from '@/components/dashboard/page-header';

export const dynamic = 'force-dynamic';

export default function NewOutboundCampaignPage() {
  return (
    <div>
      <PageHeader
        title="Nueva campaña"
        description="Cargá un CSV con los teléfonos. Lo lanzás desde el detalle cuando todo esté listo."
      />
      <div className="max-w-3xl">
        <OutboundCampaignForm />
      </div>
    </div>
  );
}
