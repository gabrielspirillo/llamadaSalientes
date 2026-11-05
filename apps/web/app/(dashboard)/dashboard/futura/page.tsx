import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { type WhatsappAgentMode, isWhatsappAgentMode } from '@/lib/data/whatsapp-agent-settings';
import { db } from '@/lib/db/client';
import { esignIntegrations, tenants, whatsappAgentSettings } from '@/lib/db/schema';
import { type EnabledModules, MODULE_DEFINITIONS, MODULE_KEYS } from '@/lib/modules';
import { getCurrentTenant } from '@/lib/tenant';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { BarChart3, LayoutDashboard } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ModuleToggle } from '../configuration/_panels/modules-panel-toggle';
import { ActivateButton } from './activate-button';
import { AgentModeDialog } from './agent-mode-dialog';
import { ArchiveClinicButton, DeleteClinicButton, RestoreClinicButton } from './archive-controls';
import { BrandingDialog } from './branding-dialog';
import { EnterButton } from './enter-button';
import { EsignDialog } from './esign-dialog';
import { type FuturaInvite, type FuturaMember, FuturaTeam } from './futura-team';

export const dynamic = 'force-dynamic';

type Status = 'onboarding' | 'pending' | 'trial' | 'active' | 'suspended' | string;

const STATUS_META: Record<
  string,
  { label: string; tone: 'neutral' | 'success' | 'warn' | 'danger' | 'info' | 'accent' }
> = {
  onboarding: { label: 'En onboarding', tone: 'warn' },
  pending: { label: 'Pendiente de activar', tone: 'accent' },
  trial: { label: 'Trial', tone: 'info' },
  active: { label: 'Activa', tone: 'success' },
  suspended: { label: 'Suspendida', tone: 'danger' },
  archived: { label: 'Archivada', tone: 'neutral' },
};

// Prioridad de orden: primero las que necesitan atención.
const ORDER: Record<string, number> = {
  pending: 0,
  onboarding: 1,
  trial: 2,
  active: 3,
  suspended: 4,
};

function fmtDate(d: Date | string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

export default async function FuturaPanelPage() {
  const {
    isSuperAdmin,
    realTenant,
    tenant: actingTenant,
    impersonating,
  } = await getCurrentTenant();
  if (!isSuperAdmin) {
    notFound();
  }

  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      enabledModules: tenants.enabledModules,
      logoUrl: tenants.logoUrl,
      createdAt: tenants.createdAt,
      agentMode: whatsappAgentSettings.agentMode,
      deriveFallbackPhone: whatsappAgentSettings.deriveFallbackPhone,
      esignBaseUrl: esignIntegrations.baseUrl,
      esignActive: esignIntegrations.active,
    })
    .from(tenants)
    // LEFT: la clínica que nunca se configuró no tiene fila y es 'BOOKING'.
    .leftJoin(whatsappAgentSettings, eq(whatsappAgentSettings.tenantId, tenants.id))
    // LEFT: la firma digital sólo la tienen las clínicas que la pidieron.
    .leftJoin(esignIntegrations, eq(esignIntegrations.tenantId, tenants.id));

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.futuradigital.es').replace(
    /\/+$/,
    '',
  );

  const team = await loadFuturaTeam(realTenant.clerkOrganizationId);

  const all = rows.map((r) => ({ ...r, status: (r.status ?? 'trial') as Status }));
  const archived = all
    .filter((c) => c.status === 'archived')
    .sort((a, b) => a.name.localeCompare(b.name));
  const clinics = all
    .filter((c) => c.status !== 'archived')
    .sort((a, b) => {
      const pa = ORDER[a.status] ?? 5;
      const pb = ORDER[b.status] ?? 5;
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name);
    });

  const total = clinics.length;
  const activas = clinics.filter((c) => c.status === 'active').length;
  const pendientes = clinics.filter(
    (c) => c.status === 'pending' || c.status === 'onboarding',
  ).length;

  return (
    <>
      <PageHeader
        eyebrow="Interno"
        icon={<LayoutDashboard className="h-5 w-5" />}
        title="Panel Futura"
        description="Gestiona las clínicas de la plataforma: activa las altas nuevas y controla sus módulos."
        actions={
          <Link
            href="/dashboard/futura/uso"
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-zinc-800"
          >
            <BarChart3 className="h-4 w-4" />
            Uso de la plataforma
          </Link>
        }
      />

      <p className="mb-5 text-[13px] text-zinc-500">
        Tu tenant (Futura):{' '}
        <code className="rounded-lg bg-brand-50 px-1.5 py-0.5 font-mono text-brand-600">
          {realTenant.id}
        </code>{' '}
        · {realTenant.slug}
      </p>

      <FuturaTeam members={team.members} invites={team.invites} />

      {/* Resumen */}
      <div className="stagger mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Clínicas" value={total} tone="neutral" />
        <StatCard label="Activas" value={activas} tone="success" />
        <StatCard label="Pendientes de activar" value={pendientes} tone="accent" />
      </div>

      {clinics.length === 0 ? (
        <div className="rounded-[22px] border border-(--color-border) bg-white p-12 text-center text-[14px] text-zinc-500 shadow-[var(--shadow-soft)]">
          Todavía no hay clínicas registradas.
        </div>
      ) : (
        <div className="space-y-3">
          {clinics.map((c) => {
            const modules = (c.enabledModules ?? {}) as EnabledModules;
            const agentMode: WhatsappAgentMode = isWhatsappAgentMode(c.agentMode)
              ? c.agentMode
              : 'BOOKING';
            const meta = STATUS_META[c.status] ?? { label: c.status, tone: 'neutral' as const };
            const isFutura = c.id === realTenant.id;
            const needsAttention = c.status === 'pending' || c.status === 'onboarding';
            return (
              <div
                key={c.id}
                className={`rounded-[22px] border bg-white p-5 shadow-[var(--shadow-soft)] transition-all duration-300 hover:shadow-[var(--shadow-lifted)] ${
                  needsAttention ? 'border-brand-200' : 'border-(--color-border)'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    {c.logoUrl && (
                      <img
                        src={c.logoUrl}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-xl border border-(--color-border) bg-white object-contain p-1"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[16px] font-bold tracking-tight text-zinc-900">
                          {c.name}
                        </h3>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        {isFutura && <Badge tone="success">Futura</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {c.slug} · creada el {fmtDate(c.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <BrandingDialog tenantId={c.id} name={c.name} logoUrl={c.logoUrl} />
                    {!isFutura && (
                      <AgentModeDialog
                        tenantId={c.id}
                        mode={agentMode}
                        fallbackPhone={c.deriveFallbackPhone}
                      />
                    )}
                    {!isFutura && (
                      <EsignDialog
                        tenantId={c.id}
                        configured={Boolean(c.esignActive)}
                        baseUrl={c.esignBaseUrl ?? null}
                        webhookUrl={`${appUrl}/api/webhooks/documenso/${c.id}`}
                      />
                    )}
                    {!isFutura && (
                      <>
                        {impersonating && c.id === actingTenant.id ? (
                          <Badge tone="accent">Gestionando ahora</Badge>
                        ) : (
                          <EnterButton tenantId={c.id} />
                        )}
                        <ActivateButton tenantId={c.id} active={c.status === 'active'} />
                        <ArchiveClinicButton tenantId={c.id} name={c.name} />
                      </>
                    )}
                  </div>
                </div>

                {/* Módulos por clínica */}
                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-(--color-border-subtle) pt-4">
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                    Módulos
                  </span>
                  {MODULE_KEYS.map((key) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-sm text-zinc-600">{MODULE_DEFINITIONS[key].label}</span>
                      <ModuleToggle
                        tenantId={c.id}
                        moduleKey={key}
                        initialEnabled={Boolean(modules?.[key])}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {archived.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-[12px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            Archivadas ({archived.length})
          </h2>
          <div className="space-y-2">
            {archived.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-dashed border-(--color-border) bg-white/60 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-zinc-700">{c.name}</p>
                  <p className="text-xs text-zinc-500">
                    {c.slug} · creada el {fmtDate(c.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <RestoreClinicButton tenantId={c.id} />
                  <DeleteClinicButton tenantId={c.id} name={c.name} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'success' | 'accent';
}) {
  const ring =
    tone === 'success' ? 'from-emerald-50' : tone === 'accent' ? 'from-brand-50' : 'from-zinc-50';
  return (
    <div
      className={`rounded-[22px] border border-(--color-border) bg-gradient-to-br ${ring} to-white p-5 shadow-[var(--shadow-soft)] transition-all duration-300 hover:shadow-[var(--shadow-lifted)]`}
    >
      <p className="text-[14px] font-medium text-zinc-500">{label}</p>
      <p className="mt-2 text-[34px] font-bold leading-none tracking-tight tabular-nums text-zinc-900">
        {value}
      </p>
    </div>
  );
}

/** Miembros e invitaciones de la organización de Futura en Clerk. */
async function loadFuturaTeam(
  orgId: string,
): Promise<{ members: FuturaMember[]; invites: FuturaInvite[] }> {
  try {
    const [{ userId }, clerk] = await Promise.all([auth(), clerkClient()]);
    const [memberships, invitations] = await Promise.all([
      clerk.organizations.getOrganizationMembershipList({ organizationId: orgId, limit: 200 }),
      clerk.organizations
        .getOrganizationInvitationList({ organizationId: orgId, status: ['pending'], limit: 100 })
        .catch(() => ({ data: [] as { emailAddress: string }[] })),
    ]);
    return {
      members: memberships.data
        .map((m) => {
          const u = m.publicUserData;
          return {
            clerkUserId: u?.userId ?? '',
            name: [u?.firstName, u?.lastName].filter(Boolean).join(' '),
            email: u?.identifier ?? '',
            isMe: u?.userId === userId,
          };
        })
        .filter((m) => m.clerkUserId)
        .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.email.localeCompare(b.email)),
      invites: invitations.data.map((i) => ({ email: i.emailAddress })),
    };
  } catch {
    return { members: [], invites: [] };
  }
}
