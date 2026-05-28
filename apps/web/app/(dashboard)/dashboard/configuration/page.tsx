import { PageHeader } from '@/components/dashboard/page-header';
import { ConfigurationTabs, type ConfigTab } from './configuration-tabs';
import { IntegrationsPanel } from './_panels/integrations-panel';
import { TelephonyPanel } from './_panels/telephony-panel';
import { WhatsappPanel } from './_panels/whatsapp-panel';

export const dynamic = 'force-dynamic';

const VALID_TABS = new Set<ConfigTab>(['whatsapp', 'telephony', 'integrations']);

export default async function ConfigurationPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; ghl?: string; ghl_error?: string }>;
}) {
  const sp = await searchParams;
  const raw = (sp.tab ?? 'whatsapp') as ConfigTab;
  const tab: ConfigTab = VALID_TABS.has(raw) ? raw : 'whatsapp';

  return (
    <>
      <PageHeader
        title="Configuración"
        description="Conexiones técnicas: WhatsApp, telefonía y CRM. Equipo técnico únicamente."
      />
      <ConfigurationTabs active={tab} />
      {tab === 'whatsapp' && <WhatsappPanel />}
      {tab === 'telephony' && <TelephonyPanel />}
      {tab === 'integrations' && (
        <IntegrationsPanel flash={{ ghl: sp.ghl, ghl_error: sp.ghl_error }} />
      )}
    </>
  );
}
