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
        eyebrow="Laboratorio"
        icon={<Bot className="h-5 w-5" />}
        title="Probar agente"
        description="Hablá con tu agente de voz directamente desde el navegador, sin usar el teléfono."
      />

      {!hasAgent ? (
        <Card>
          <EmptyState
            icon={<Bot className="h-5 w-5" />}
            title="Agente no vinculado"
            description="Tu administrador necesita vincular el agente antes de poder probarlo."
          />
        </Card>
      ) : (
        <AgentTester />
      )}
    </>
  );
}
