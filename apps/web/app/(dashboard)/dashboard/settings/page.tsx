import { PageHeader } from '@/components/dashboard/page-header';
import { getClinicSettings } from '@/lib/data/clinic';
import { getWhatsappAgentSettings } from '@/lib/data/whatsapp-agent-settings';
import { getCurrentTenant } from '@/lib/tenant';
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
          description="Información que el agente usa al hablar con pacientes."
        />
        <p className="text-sm text-zinc-500">
          No se encontró la configuración de la clínica. Contactá soporte.
        </p>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={tenant.name}
        description="Información que el agente usa al hablar con pacientes."
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

      <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-zinc-900">Personalización del agente IA</h2>
          <p className="text-sm text-zinc-500">
            Nombre y tono/estilo con que el agente de WhatsApp atiende a los pacientes de
            esta clínica. Es aditivo: no cambia las reglas de seguridad ni los datos oficiales.
          </p>
        </div>
        <AgentPersonaForm
          initial={
            agentSettings
              ? { persona: agentSettings.persona, agentName: agentSettings.agentName }
              : null
          }
        />
      </section>
    </>
  );
}
