import { deriveIntakeKey } from '@/lib/auth/intake-key';
import { getGhlIntegration, isPitIntegration } from '@/lib/data/ghl-integration';
import { getCurrentTenant } from '@/lib/tenant';
import { headers } from 'next/headers';
import { AutoCallbackCard } from '../../settings/auto-callback-card';
import { GhlCard } from '../../settings/ghl-card';

export async function IntegrationsPanel({
  flash,
}: {
  flash: { ghl?: string; ghl_error?: string };
}) {
  const { tenant } = await getCurrentTenant();
  const ghl = await getGhlIntegration(tenant.id);

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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">Integraciones</h2>
        <p className="text-sm text-zinc-500">
          Conexión con GoHighLevel y URLs de webhook para auto-callback.
        </p>
      </div>

      {flash.ghl === 'connected' && (
        <Banner kind="success">GoHighLevel conectado correctamente.</Banner>
      )}
      {flash.ghl_error && (
        <Banner kind="error">
          La conexión con GoHighLevel falló: <code>{flash.ghl_error}</code>. Probá de nuevo o
          contactá soporte.
        </Banner>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
        <AutoCallbackCard
          intakeUrl={intakeUrl}
          intakeKey={intakeKey}
          ghlWebhookUrl={ghlWebhookUrl}
          locationId={ghl?.locationId ?? null}
        />
      </div>
    </div>
  );
}

function Banner({ kind, children }: { kind: 'success' | 'error'; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm ${
        kind === 'success'
          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : 'bg-red-50 border-red-200 text-red-800'
      }`}
    >
      {children}
    </div>
  );
}
