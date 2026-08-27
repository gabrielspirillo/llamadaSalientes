import { getGhlIntegration } from '@/lib/data/ghl-integration';
import { getTenantTelephony } from '@/lib/data/tenant-telephony';
import { db } from '@/lib/db/client';
import { whatsappConnections } from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';
import { eq } from 'drizzle-orm';
import {
  CheckCircle2,
  Clock,
  Database,
  MessageCircle,
  Phone,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

type Conn = { connected: boolean };

async function loadStatus(tenantId: string): Promise<{
  whatsapp: Conn;
  telephony: Conn;
  crm: Conn;
}> {
  const [ghl, tel, wa] = await Promise.all([
    getGhlIntegration(tenantId).catch(() => null),
    getTenantTelephony(tenantId).catch(() => null),
    db
      .select({ status: whatsappConnections.status })
      .from(whatsappConnections)
      .where(eq(whatsappConnections.tenantId, tenantId))
      .catch(() => [] as { status: string | null }[]),
  ]);

  const whatsapp = Array.isArray(wa)
    ? wa.some((r) => String(r.status ?? '').toUpperCase() === 'CONNECTED')
    : false;
  const telephony = Boolean(tel && (tel.inboundNumberE164 || tel.provider));
  const crm = Boolean(ghl);

  return {
    whatsapp: { connected: whatsapp },
    telephony: { connected: telephony },
    crm: { connected: crm },
  };
}

function StatusPill({ connected }: { connected: boolean }) {
  return connected ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
      <CheckCircle2 className="h-3.5 w-3.5" />
      Conectado
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
      <Clock className="h-3.5 w-3.5" />
      En preparación
    </span>
  );
}

function ConnectionCard({
  icon,
  tint,
  title,
  description,
  connected,
}: {
  icon: React.ReactNode;
  tint: string;
  title: string;
  description: string;
  connected: boolean;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-zinc-200/70 bg-white p-5 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${tint}`}>
          {icon}
        </span>
        <StatusPill connected={connected} />
      </div>
      <h3 className="mt-4 font-medium text-zinc-900">{title}</h3>
      <p className="mt-1 text-sm text-zinc-500">{description}</p>
    </div>
  );
}

export async function AgentStatusPanel() {
  const { tenant } = await getCurrentTenant();
  const status = await loadStatus(tenant.id);

  const total = 3;
  const ready = [status.whatsapp, status.telephony, status.crm].filter((c) => c.connected).length;
  const allReady = ready === total;

  return (
    <div className="space-y-5">
      {/* Hero de estado general */}
      <div
        className={`relative overflow-hidden rounded-2xl border p-6 sm:p-7 ${
          allReady
            ? 'border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-white'
            : 'border-violet-200/60 bg-gradient-to-br from-violet-50 to-white'
        }`}
      >
        <div className="flex items-start gap-4">
          <span
            className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
              allReady ? 'bg-emerald-600' : 'bg-violet-600'
            }`}
          >
            {allReady ? (
              <Sparkles className="h-6 w-6 text-white" />
            ) : (
              <ShieldCheck className="h-6 w-6 text-white" />
            )}
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900 sm:text-xl">
              {allReady ? 'Tu agente está activo y funcionando' : 'Estamos preparando tu agente'}
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              {allReady
                ? 'Todas las conexiones están listas. Tu agente ya puede atender.'
                : 'El equipo de Futura está terminando de conectar tu agente. No necesitás hacer nada.'}
            </p>
            <p className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-zinc-500">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
              {ready} de {total} conexiones listas
            </p>
          </div>
        </div>
      </div>

      {/* Conexiones */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ConnectionCard
          icon={<MessageCircle className="h-5 w-5 text-emerald-600" />}
          tint="bg-emerald-50"
          title="WhatsApp"
          description="Para que el agente converse con tus pacientes por WhatsApp."
          connected={status.whatsapp.connected}
        />
        <ConnectionCard
          icon={<Phone className="h-5 w-5 text-blue-600" />}
          tint="bg-blue-50"
          title="Telefonía"
          description="La línea con la que tu agente llama y recibe llamadas."
          connected={status.telephony.connected}
        />
        <ConnectionCard
          icon={<Database className="h-5 w-5 text-violet-600" />}
          tint="bg-violet-50"
          title="CRM / Agenda"
          description="La conexión con tu sistema de turnos y contactos."
          connected={status.crm.connected}
        />
      </div>

      {/* Nota */}
      <div className="flex items-start gap-3 rounded-2xl border border-zinc-200/70 bg-zinc-50/60 p-4 sm:p-5">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400" />
        <p className="text-sm text-zinc-600">
          Estas conexiones las configura y mantiene el equipo de{' '}
          <span className="font-medium text-zinc-900">Futura Solutions</span>. No necesitás tocar
          nada acá — si algo no aparece conectado, ya estamos en eso. ¿Dudas? Escribinos.
        </p>
      </div>
    </div>
  );
}
