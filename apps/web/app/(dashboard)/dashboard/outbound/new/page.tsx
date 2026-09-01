import { OutboundCampaignForm } from '@/components/dashboard/outbound-campaign-form';
import { PageHeader } from '@/components/dashboard/page-header';
import { PhoneOutgoing } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function NewOutboundCampaignPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Canal saliente"
        icon={<PhoneOutgoing className="h-5 w-5" />}
        title="Nueva campaña"
        description="Cargá un CSV con los teléfonos. Lo lanzás desde el detalle cuando todo esté listo."
      />
      <div className="max-w-3xl">
        <OutboundCampaignForm />
      </div>
    </div>
  );
}
