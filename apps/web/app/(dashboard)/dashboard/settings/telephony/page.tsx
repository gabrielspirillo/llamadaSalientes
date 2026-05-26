import { PageHeader } from '@/components/dashboard/page-header';
import { getTenantTelephony } from '@/lib/data/tenant-telephony';
import type { TelephonyProvider } from '@/lib/telephony/provider';
import { getCurrentTenant } from '@/lib/tenant';
import { headers } from 'next/headers';
import { TelephonySettings } from './telephony-settings';

export default async function TelephonyPage() {
  const { tenant } = await getCurrentTenant();
  const t = await getTenantTelephony(tenant.id);

  const hdrs = await headers();
  const host = hdrs.get('host') ?? 'localhost:3000';
  const proto =
    hdrs.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https');
  const baseUrl = `${proto}://${host}`;

  return (
    <>
      <PageHeader
        title="Telefonía"
        description="Configurá las llamadas multi-tenant: provider, caller ID saliente y número entrante propios."
      />
      <TelephonySettings
        initial={{
          provider: ((t?.provider as TelephonyProvider | undefined) ?? 'twilio'),
          twilioConfigured: !!t?.twilioAccountSid,
          twilioAccountSid: t?.twilioAccountSid ?? null,
          zadarmaConfigured: !!t?.zadarmaUserKey,
          zadarmaUserKey: t?.zadarmaUserKey ?? null,
          zadarmaWebhookSecretSet: !!t?.zadarmaWebhookSecretEnc,
          callerIdE164: t?.callerIdE164 ?? null,
          callerIdVerifiedAt: t?.callerIdVerifiedAt
            ? t.callerIdVerifiedAt.toISOString()
            : null,
          inboundNumberE164: t?.inboundNumberE164 ?? null,
          inboundConfiguredAt: t?.inboundConfiguredAt
            ? t.inboundConfiguredAt.toISOString()
            : null,
          inboundRoute: (t?.inboundRoute ?? 'agent') as 'agent' | 'forward',
          inboundForwardNumber: t?.inboundForwardNumber ?? null,
        }}
        webhookUrls={{
          twilio: {
            voice: `${baseUrl}/api/twilio/inbound-voice`,
            sms: `${baseUrl}/api/twilio/sms-passthrough`,
          },
          zadarma: {
            webhook: `${baseUrl}/api/zadarma/webhook`,
          },
        }}
      />
    </>
  );
}
