import { PageHeader } from '@/components/dashboard/page-header';
import { getCurrentTenant } from '@/lib/tenant';
import { Settings, ShieldCheck } from 'lucide-react';
import { AgentStatusPanel } from './_panels/agent-status-panel';
import { IntegrationsPanel } from './_panels/integrations-panel';
import { ModulesPanel } from './_panels/modules-panel';
import { PlaygroundPanel } from './_panels/playground-panel';
import { TelephonyPanel } from './_panels/telephony-panel';
import { WhatsappPanel } from './_panels/whatsapp-panel';
import { type ConfigTab, ConfigurationTabs } from './configuration-tabs';

export const dynamic = 'force-dynamic';

const PUBLIC_TABS = new Set<ConfigTab>(['whatsapp', 'playground', 'telephony', 'integrations']);

export default async function ConfigurationPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; ghl?: string; ghl_error?: string }>;
}) {
  const sp = await searchParams;
  const { isSuperAdmin } = await getCurrentTenant();

  // Vista de la CLÍNICA: solo lectura. No ve ni puede tocar las conexiones
  // técnicas (las gestiona Futura). Muestra el estado de su agente.
  if (!isSuperAdmin) {
    return (
      <>
        <PageHeader
          eyebrow="Estado"
          icon={<ShieldCheck className="h-5 w-5" />}
          title="Estado de tu asistente"
          description="Cómo va la puesta a punto de tu asistente de voz."
        />
        <AgentStatusPanel />
      </>
    );
  }

  // Vista de FUTURA (super-admin): conexiones técnicas completas.
  const raw = (sp.tab ?? 'whatsapp') as ConfigTab;
  const tab: ConfigTab = raw === 'modules' ? 'modules' : PUBLIC_TABS.has(raw) ? raw : 'whatsapp';

  return (
    <>
      <PageHeader
        eyebrow="Interno"
        icon={<Settings className="h-5 w-5" />}
        title="Configuración"
        description="Conexiones técnicas: WhatsApp, telefonía y CRM. Equipo técnico únicamente."
      />
      <ConfigurationTabs active={tab} showModulesTab={isSuperAdmin} />
      {tab === 'whatsapp' && <WhatsappPanel />}
      {tab === 'playground' && <PlaygroundPanel />}
      {tab === 'telephony' && <TelephonyPanel />}
      {tab === 'integrations' && (
        <IntegrationsPanel flash={{ ghl: sp.ghl, ghl_error: sp.ghl_error }} />
      )}
      {tab === 'modules' && <ModulesPanel />}
    </>
  );
}
