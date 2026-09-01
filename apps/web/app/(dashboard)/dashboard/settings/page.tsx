import { PageHeader } from '@/components/dashboard/page-header';
import { Card, CardTopbar } from '@/components/ui/card';
import { Reveal } from '@/components/ui/motion';
import { getClinicSettings } from '@/lib/data/clinic';
import { getWhatsappAgentSettings } from '@/lib/data/whatsapp-agent-settings';
import { getCurrentTenant } from '@/lib/tenant';
import { Building2, Sparkles } from 'lucide-react';
import { AgentPersonaForm } from '../whatsapp/integrations/_components/agent-persona-form';
import { SettingsForm } from './settings-form';

export default async function SettingsPage() {
  const { tenant } = await getCurrentTenant();
  const settings = await getClinicSettings(tenant.id);
  const agentSettings = await getWhatsappAgentSettings(tenant.id);

  if (!settings) {
    return (
      <div>
        <PageHeader
          title="Clínica"
          description="Información que el agente usa cuando habla con los pacientes."
        />
        <p className="text-sm text-zinc-500">
          No se ha encontrado la configuración de la clínica. Ponte en contacto con soporte.
        </p>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Datos de la clínica"
        icon={<Building2 className="h-5 w-5" />}
        title={tenant.name}
        description="Información que el agente usa cuando habla con los pacientes."
      />

      <SettingsForm
        initial={{
          address: settings.address,
          phones: settings.phones,
          timezone: settings.timezone,
          defaultLanguage: settings.defaultLanguage,
          afterHoursMessage: settings.afterHoursMessage,
          recordingConsentText: settings.recordingConsentText,
          transferNumber: settings.transferNumber,
          workingHours: settings.workingHours as never,
        }}
      />

      <Reveal className="mt-8 block">
        <Card>
          <CardTopbar
            icon={<Sparkles className="h-4 w-4" />}
            tone="blossom"
            title="Personalización del agente"
            subtitle="Nombre y tono con los que el agente de WhatsApp atiende a tus pacientes. Solo añade estilo: no cambia las reglas de seguridad ni los datos oficiales de la clínica."
          />
          <div className="px-5 pb-5 sm:px-6 sm:pb-6">
            <AgentPersonaForm
              initial={
                agentSettings
                  ? { persona: agentSettings.persona, agentName: agentSettings.agentName }
                  : null
              }
            />
          </div>
        </Card>
      </Reveal>
    </>
  );
}
