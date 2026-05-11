import { PageHeader } from '@/components/dashboard/page-header';
import { deriveIntakeKey } from '@/lib/auth/intake-key';
import { getClinicSettings } from '@/lib/data/clinic';
import { getGhlIntegration, isPitIntegration } from '@/lib/data/ghl-integration';
import { getCurrentTenant } from '@/lib/tenant';
import { AutoCallbackCard } from './auto-callback-card';
import { GhlCard } from './ghl-card';
import { SettingsForm } from './settings-form';

import { headers } from 'next/headers';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ghl?: string; ghl_error?: string }>;
}) {
  const sp = await searchParams;
  const { tenant } = await getCurrentTenant();
  const [settings, ghl] = await Promise.all([
    getClinicSettings(tenant.id),
    getGhlIntegration(tenant.id),
  ]);

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

  const ghlCard = (
    <GhlCard
      status={
        ghl
          ? {
              kind: 'connected',
              locationId: ghl.locationId,
              scopes: ghl.scopes,
              connectedAt: ghl.connectedAt,
              expiresAt: ghl.expiresAt,
              method: isPitIntegration(ghl) ? 'pit' : 'oauth',
            }
          : { kind: 'disconnected' }
      }
    />
  );

  // Construir URLs absolutas para el panel auto-callback
  const hdrs = await headers();
  const host = hdrs.get('host') ?? 'localhost:3000';
  const proto =
    hdrs.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https');
  const baseUrl = `${proto}://${host}`;
  const intakeKey = deriveIntakeKey(tenant.id);
  const intakeUrl = `${baseUrl}/api/leads/intake?tenant=${encodeURIComponent(tenant.slug)}`;
  const ghlWebhookUrl = ghl
    ? `${baseUrl}/api/webhooks/ghl/contact?location=${encodeURIComponent(ghl.locationId)}`
    : `${baseUrl}/api/webhooks/ghl/contact`;

  const autoCallbackCard = (
    <AutoCallbackCard
      intakeUrl={intakeUrl}
      intakeKey={intakeKey}
      ghlWebhookUrl={ghlWebhookUrl}
      locationId={ghl?.locationId ?? null}
    />
  );

  return (
    <>
      <PageHeader
        title={tenant.name}
        description="Información que el agente usa al hablar con pacientes."
      />

      {sp.ghl === 'connected' && (
        <Banner kind="success">GoHighLevel conectado correctamente.</Banner>
      )}
      {sp.ghl_error && (
        <Banner kind="error">
          La conexión con GoHighLevel falló: <code>{sp.ghl_error}</code>. Probá de nuevo o contactá
          soporte.
        </Banner>
      )}

      <SettingsForm
        ghlSlot={ghlCard}
        autoCallbackSlot={autoCallbackCard}
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

function Banner({ kind, children }: { kind: 'success' | 'error'; children: React.ReactNode }) {
  return (
    <div
      className={`mb-6 rounded-xl border px-4 py-3 text-sm ${
        kind === 'success'
          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : 'bg-red-50 border-red-200 text-red-800'
      }`}
    >
      {children}
    </div>
  );
}
