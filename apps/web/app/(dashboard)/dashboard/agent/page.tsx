import { PageHeader } from '@/components/dashboard/page-header';
import { AgentTester } from '@/components/dashboard/agent-tester';
import { Card } from '@/components/ui/card';
import { getAgentConfig } from '@/lib/data/agent-config';
import { getCurrentTenantOrNull } from '@/lib/tenant';

export default async function AgentPage() {
  const ctx = await getCurrentTenantOrNull();
  const config = ctx ? await getAgentConfig(ctx.tenant.id) : null;
  const hasAgent = Boolean(config?.retellAgentId) || Boolean(process.env.RETELL_DEFAULT_AGENT_ID);

  return (
    <>
      <PageHeader
        title="Probar agente"
        description="Hablá con tu agente de voz directamente desde el navegador."
      />

      {!hasAgent ? (
        <Card>
          <div className="p-10 text-center max-w-lg mx-auto">
            <h3 className="text-lg font-semibold tracking-tight">Agente no vinculado</h3>
            <p className="text-sm text-zinc-500 mt-2">
              Tu administrador necesita vincular el agente antes de poder probarlo.
            </p>
          </div>
        </Card>
      ) : (
        <AgentTester />
      )}
    </>
  );
}
