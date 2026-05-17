import { PageHeader } from '@/components/dashboard/page-header';
import { getTenantTelephony } from '@/lib/data/tenant-telephony';
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
  const voiceWebhookUrl = `${baseUrl}/api/twilio/inbound-voice`;
  const smsWebhookUrl = `${baseUrl}/api/twilio/sms-passthrough`;

  return (
    <>
      <PageHeader
        title="Telefonía"
        description="Configurá las llamadas multi-tenant: caller ID saliente y número entrante propios."
      />
      <TelephonySettings
        initial={{
          configured: !!t?.twilioAccountSid,
          accountSid: t?.twilioAccountSid ?? null,
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
        webhookUrls={{ voice: voiceWebhookUrl, sms: smsWebhookUrl }}
      />
    </>
  );
}
