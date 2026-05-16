import Link from 'next/link';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { whatsappConnections } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { getCurrentTenant } from '@/lib/tenant';

import { CloudConnectionForm } from './_components/cloud-connection-form';
import { EvolutionConnectionPanel } from './_components/evolution-connection-panel';
import { TwilioConnectionForm } from './_components/twilio-connection-form';

export const dynamic = 'force-dynamic';

export default async function WhatsappIntegrationsPage() {
  const { tenant } = await getCurrentTenant();

  const rows = await db
    .select()
    .from(whatsappConnections)
    .where(eq(whatsappConnections.tenantId, tenant.id));
  const cloud = rows.find((r) => r.mode === 'CLOUD');
  const evolution = rows.find((r) => r.mode === 'EVOLUTION');
  const twilio = rows.find((r) => r.mode === 'TWILIO');

  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  const cloudWebhookUrl = `${appUrl}/api/webhooks/whatsapp/cloud`;
  const evolutionWebhookUrl = `${appUrl}/api/webhooks/whatsapp/evolution`;
  const twilioWebhookUrl = `${appUrl}/api/webhooks/whatsapp/twilio`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard/whatsapp" className="text-sm text-zinc-500 hover:text-zinc-700">
            ← WhatsApp
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-900">
            Integraciones de WhatsApp
          </h1>
          <p className="text-sm text-zinc-500">
            Conecta Meta Cloud API (oficial), Twilio (BSP oficial) o Evolution API
            (self-hosted, Baileys).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {/* Cloud API */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">Meta Cloud API</h2>
              <p className="text-xs text-zinc-500">
                Recomendado para producción. Requiere WABA aprobada.
              </p>
            </div>
            <StatusBadge status={cloud?.status ?? 'NOT_CONFIGURED'} />
          </div>

          <div className="mb-4 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700">
            <div className="font-medium">Webhook URL</div>
            <code className="block break-all text-[11px] text-zinc-600">{cloudWebhookUrl}</code>
            <div className="mt-2 font-medium">Verify token</div>
            <code className="block text-[11px] text-zinc-600">
              {process.env.WHATSAPP_VERIFY_TOKEN
                ? '✓ Configurado (env WHATSAPP_VERIFY_TOKEN)'
                : '⚠️ WHATSAPP_VERIFY_TOKEN no configurado en env'}
            </code>
          </div>

          <CloudConnectionForm
            initial={
              cloud
                ? {
                    phoneNumberId: cloud.phoneId ?? '',
                    wabaId: cloud.wabaId ?? '',
                  }
                : null
            }
          />
        </section>

        {/* Evolution */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">Evolution API</h2>
              <p className="text-xs text-zinc-500">
                Self-hosted (Baileys). Útil para pilotos. Riesgo de baneo del número.
              </p>
            </div>
            <StatusBadge status={evolution?.status ?? 'NOT_CONFIGURED'} />
          </div>

          <div className="mb-4 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700">
            <div className="font-medium">Webhook URL</div>
            <code className="block break-all text-[11px] text-zinc-600">
              {evolutionWebhookUrl}
            </code>
            <div className="mt-2 font-medium">Servidor Evolution</div>
            <code className="block text-[11px] text-zinc-600">
              {process.env.EVOLUTION_API_URL
                ? `✓ ${process.env.EVOLUTION_API_URL}`
                : '⚠️ EVOLUTION_API_URL no configurado'}
            </code>
          </div>

          <EvolutionConnectionPanel
            initial={
              evolution
                ? {
                    instanceName: evolution.evolutionInstance,
                    qrBase64: evolution.qrB64,
                    status: evolution.status,
                  }
                : null
            }
          />
        </section>

        {/* Twilio */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">Twilio (BSP)</h2>
              <p className="text-xs text-zinc-500">
                Business Solution Provider oficial. Sender propio aprobado.
              </p>
            </div>
            <StatusBadge status={twilio?.status ?? 'NOT_CONFIGURED'} />
          </div>

          <div className="mb-4 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700">
            <div className="font-medium">Webhook URL</div>
            <code className="block break-all text-[11px] text-zinc-600">{twilioWebhookUrl}</code>
            <div className="mt-2 font-medium">Cómo configurarlo</div>
            <p className="text-[11px] text-zinc-600">
              En Twilio Console → Messaging → WhatsApp sender, pegá la URL en
              <em> When a message comes in</em> con método HTTP <code>POST</code>.
              Twilio firma cada request con tu Auth Token; lo verificamos en cada
              callback.
            </p>
          </div>

          <TwilioConnectionForm
            initial={
              twilio && twilio.twilioAccountSid && twilio.twilioFromNumber
                ? {
                    accountSid: twilio.twilioAccountSid,
                    fromNumber: twilio.twilioFromNumber,
                  }
                : null
            }
          />
        </section>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    CONNECTED: { label: 'Conectado', cls: 'bg-emerald-100 text-emerald-800' },
    PENDING: { label: 'Pendiente', cls: 'bg-amber-100 text-amber-800' },
    DISCONNECTED: { label: 'Desconectado', cls: 'bg-zinc-100 text-zinc-600' },
    ERROR: { label: 'Error', cls: 'bg-red-100 text-red-700' },
    NOT_CONFIGURED: { label: 'No configurado', cls: 'bg-zinc-100 text-zinc-500' },
  };
  const { label, cls } = map[status] ?? map.NOT_CONFIGURED!;
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  );
}
