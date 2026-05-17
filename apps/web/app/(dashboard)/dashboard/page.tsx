import { GlobalAnalyticsBar } from '@/components/dashboard/global-analytics-bar';
import { InboundModule } from '@/components/dashboard/modules/inbound-module';
import { OutboundModule } from '@/components/dashboard/modules/outbound-module';
import { WhatsappModule } from '@/components/dashboard/modules/whatsapp-module';
import { PageHeader } from '@/components/dashboard/page-header';
import { RealtimeRefresh } from '@/components/dashboard/realtime-refresh';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getCurrentTenant } from '@/lib/tenant';
import { ArrowRight, MessageCircle, Phone, PhoneOutgoing } from 'lucide-react';
import Link from 'next/link';

export default async function DashboardOverview() {
  const { tenant } = await getCurrentTenant();

  return (
    <>
      <PageHeader
        title={`Buenas, ${tenant.name.split(/['']s|\s/)[0]}`}
        description="Resumen en tiempo real de tu clínica."
        actions={
          <Button asChild>
            <Link href="/dashboard/agent">
              Probar agente <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        }
      />
      {/* Sin UI: refresca server components cada 30s mientras la pestaña está visible */}
      <div className="hidden">
        <RealtimeRefresh intervalMs={30_000} />
      </div>

      <GlobalAnalyticsBar tenantId={tenant.id} />

      <Tabs defaultValue="inbound">
        <TabsList>
          <TabsTrigger value="outbound">
            <PhoneOutgoing className="h-3.5 w-3.5 mr-1.5" />
            Salientes
          </TabsTrigger>
          <TabsTrigger value="inbound">
            <Phone className="h-3.5 w-3.5 mr-1.5" />
            Entrantes
          </TabsTrigger>
          <TabsTrigger value="whatsapp">
            <MessageCircle className="h-3.5 w-3.5 mr-1.5" />
            WhatsApp
          </TabsTrigger>
        </TabsList>

        <TabsContent value="outbound">
          <OutboundModule />
        </TabsContent>
        <TabsContent value="inbound">
          <InboundModule tenantId={tenant.id} />
        </TabsContent>
        <TabsContent value="whatsapp">
          <WhatsappModule />
        </TabsContent>
      </Tabs>
    </>
  );
}
