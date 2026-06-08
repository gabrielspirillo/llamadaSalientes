import { PageHeader } from '@/components/dashboard/page-header';
import { isSuperAdminTenant } from '@/lib/modules';
import { getCurrentTenant } from '@/lib/tenant';
import { ConfigurationTabs, type ConfigTab } from './configuration-tabs';
import { IntegrationsPanel } from './_panels/integrations-panel';
import { ModulesPanel } from './_panels/modules-panel';
import { PlaygroundPanel } from './_panels/playground-panel';
import { TelephonyPanel } from './_panels/telephony-panel';
import { WhatsappPanel } from './_panels/whatsapp-panel';

export const dynamic = 'force-dynamic';

const PUBLIC_TABS = new Set<ConfigTab>(['whatsapp', 'playground', 'telephony', 'integrations']);

export default async function ConfigurationPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; ghl?: string; ghl_error?: string }>;
}) {
  const sp = await searchParams;
  const { tenant } = await getCurrentTenant();
  const isSuperAdmin = isSuperAdminTenant(tenant.id);

  const raw = (sp.tab ?? 'whatsapp') as ConfigTab;
  // Tab "modules" solo accesible para super-admin; resto fallback a whatsapp.
  const isModulesTab = raw === 'modules' && isSuperAdmin;
  const tab: ConfigTab = isModulesTab ? 'modules' : PUBLIC_TABS.has(raw) ? raw : 'whatsapp';

  return (
    <>
      <PageHeader
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
