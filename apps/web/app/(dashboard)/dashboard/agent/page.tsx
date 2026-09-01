import { AgentTester } from '@/components/dashboard/agent-tester';
import { PageHeader } from '@/components/dashboard/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { getAgentConfig } from '@/lib/data/agent-config';
import { getCurrentTenantOrNull } from '@/lib/tenant';
import { Bot } from 'lucide-react';

export default async function AgentPage() {
  const ctx = await getCurrentTenantOrNull();
  const config = ctx ? await getAgentConfig(ctx.tenant.id) : null;
  const hasAgent = Boolean(config?.retellAgentId) || Boolean(process.env.RETELL_DEFAULT_AGENT_ID);

  return (
    <>
      <PageHeader
        eyebrow="Pruebas"
        icon={<Bot className="h-5 w-5" />}
        title="Probar el asistente"
        description="Habla con tu asistente de voz desde el navegador, sin usar el teléfono."
      />

      {!hasAgent ? (
        <Card>
          <EmptyState
            icon={<Bot className="h-5 w-5" />}
            title="Asistente sin vincular"
            description="Tu administrador tiene que vincular el asistente antes de que puedas probarlo."
          />
        </Card>
      ) : (
        <AgentTester />
      )}
    </>
  );
}
