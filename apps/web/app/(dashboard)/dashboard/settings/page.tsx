import { PageHeader } from '@/components/dashboard/page-header';
import { getClinicSettings } from '@/lib/data/clinic';
import { getCurrentTenant } from '@/lib/tenant';
import { SettingsForm } from './settings-form';

export default async function SettingsPage() {
  const { tenant } = await getCurrentTenant();
  const settings = await getClinicSettings(tenant.id);

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
          // Drizzle tipa workingHours como Record<string, ...> aunque insertamos
          // siempre las 7 keys; el form espera el shape estricto WorkingHours.
          workingHours: settings.workingHours as never,
        }}
      />
    </>
  );
}
