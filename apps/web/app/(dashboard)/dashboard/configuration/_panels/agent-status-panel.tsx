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
    <div className="group relative overflow-hidden rounded-[22px] border border-[--color-border] bg-white p-5 shadow-[var(--shadow-soft)] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 hover:shadow-[var(--shadow-lifted)]">
      <div className="flex items-start justify-between gap-3">
        <span
          className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110 ${tint}`}
        >
          {icon}
        </span>
        <StatusPill connected={connected} />
      </div>
      <h3 className="mt-4 text-[15px] font-bold text-zinc-900">{title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">{description}</p>
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
        className={`relative overflow-hidden rounded-[26px] border p-6 shadow-[var(--shadow-soft)] sm:p-7 ${
          allReady
            ? 'border-emerald-200/70 bg-[linear-gradient(130deg,#e9f9f2_0%,#ffffff_60%)]'
            : 'border-violet-200/60 bg-[linear-gradient(130deg,#f4f0ff_0%,#ffffff_60%)]'
        }`}
      >
        <div
          aria-hidden
          className={`pointer-events-none absolute -right-16 -top-16 h-48 w-48 animate-float rounded-full blur-3xl ${
            allReady
              ? 'bg-[radial-gradient(circle,rgba(16,185,129,0.28),transparent_70%)]'
              : 'bg-[radial-gradient(circle,rgba(139,92,246,0.28),transparent_70%)]'
          }`}
        />
        <div className="relative flex items-start gap-4">
          <span
            className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-[0_12px_28px_-12px_rgba(23,20,41,0.6)] ${
              allReady
                ? 'bg-[linear-gradient(135deg,#059669,#34d399)]'
                : 'bg-[linear-gradient(135deg,#7139e8,#a855f7)]'
            }`}
          >
            {allReady ? (
              <Sparkles className="h-6 w-6 text-white" />
            ) : (
              <ShieldCheck className="h-6 w-6 text-white" />
            )}
          </span>
          <div className="min-w-0">
            <h2 className="text-[19px] font-extrabold tracking-tight text-zinc-900 sm:text-[22px]">
              {allReady ? 'Tu agente está activo y funcionando' : 'Estamos preparando tu agente'}
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              {allReady
                ? 'Todas las conexiones están listas. Tu agente ya puede atender.'
                : 'El equipo de Futura está terminando de conectar tu agente. No necesitás hacer nada.'}
            </p>
            <div className="mt-4 flex max-w-xs items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/70">
                <div
                  className={`bar-fill h-full rounded-full ${
                    allReady
                      ? 'bg-[linear-gradient(90deg,#059669,#34d399)]'
                      : 'bg-[linear-gradient(90deg,#7139e8,#a855f7)]'
                  }`}
                  style={{ width: `${(ready / total) * 100}%` }}
                />
              </div>
              <span className="shrink-0 text-[11.5px] font-bold tabular-nums text-zinc-500">
                {ready}/{total}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Conexiones */}
      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ConnectionCard
          icon={<MessageCircle className="h-5 w-5 text-emerald-600" />}
          tint="bg-[linear-gradient(135deg,#e9f9f2,#d9f5e8)]"
          title="WhatsApp"
          description="Para que el agente converse con tus pacientes por WhatsApp."
          connected={status.whatsapp.connected}
        />
        <ConnectionCard
          icon={<Phone className="h-5 w-5 text-sky-600" />}
          tint="bg-[linear-gradient(135deg,#e9f4fe,#d8ecfd)]"
          title="Telefonía"
          description="La línea con la que tu agente llama y recibe llamadas."
          connected={status.telephony.connected}
        />
        <ConnectionCard
          icon={<Database className="h-5 w-5 text-violet-600" />}
          tint="bg-[linear-gradient(135deg,#f4f0ff,#ede5ff)]"
          title="CRM / Agenda"
          description="La conexión con tu sistema de turnos y contactos."
          connected={status.crm.connected}
        />
      </div>

      {/* Nota */}
      <div className="flex items-start gap-3 rounded-[22px] border border-[--color-border] bg-[#fbfaff] p-4 sm:p-5">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-400" />
        <p className="text-[13px] leading-relaxed text-zinc-600">
          Estas conexiones las configura y mantiene el equipo de{' '}
          <span className="font-medium text-zinc-900">Futura Solutions</span>. No necesitás tocar
          nada acá — si algo no aparece conectado, ya estamos en eso. ¿Dudas? Escribinos.
        </p>
      </div>
    </div>
  );
}
