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
        description="Sube un CSV con los teléfonos. La campaña se lanza desde su ficha cuando todo esté listo."
      />
      <div className="max-w-3xl">
        <OutboundCampaignForm />
      </div>
    </div>
  );
}
