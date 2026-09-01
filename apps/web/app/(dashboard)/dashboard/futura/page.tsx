import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema';
import {
  type EnabledModules,
  MODULE_DEFINITIONS,
  MODULE_KEYS,
} from '@/lib/modules';
import { getCurrentTenant } from '@/lib/tenant';
import { notFound } from 'next/navigation';
import { ModuleToggle } from '../configuration/_panels/modules-panel-toggle';
import { ActivateButton } from './activate-button';
import { EnterButton } from './enter-button';

export const dynamic = 'force-dynamic';

type Status = 'onboarding' | 'pending' | 'trial' | 'active' | 'suspended' | string;

const STATUS_META: Record<
  string,
  { label: string; tone: 'neutral' | 'success' | 'warn' | 'danger' | 'info' | 'violet' }
> = {
  onboarding: { label: 'En onboarding', tone: 'warn' },
  pending: { label: 'Pendiente de activar', tone: 'violet' },
  trial: { label: 'Trial', tone: 'info' },
  active: { label: 'Activa', tone: 'success' },
  suspended: { label: 'Suspendida', tone: 'danger' },
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
  const { isSuperAdmin, realTenant, tenant: actingTenant, impersonating } = await getCurrentTenant();
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
      createdAt: tenants.createdAt,
    })
    .from(tenants);

  const clinics = rows
    .map((r) => ({ ...r, status: (r.status ?? 'trial') as Status }))
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
        title="Panel Futura"
        description="Gestioná las clínicas de la plataforma: activá altas nuevas y controlá sus módulos."
      />

      <p className="mb-4 text-xs text-zinc-400">
        Tu tenant (Futura): <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600">{realTenant.id}</code> · {realTenant.slug}
      </p>

      {/* Resumen */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Clínicas" value={total} tone="neutral" />
        <StatCard label="Activas" value={activas} tone="success" />
        <StatCard label="Pendientes de activar" value={pendientes} tone="violet" />
      </div>

      {clinics.length === 0 ? (
        <div className="rounded-2xl border border-[--color-border] bg-white p-12 text-center text-sm text-zinc-500">
          Todavía no hay clínicas registradas.
        </div>
      ) : (
        <div className="space-y-3">
          {clinics.map((c) => {
            const modules = (c.enabledModules ?? {}) as EnabledModules;
            const meta = STATUS_META[c.status] ?? { label: c.status, tone: 'neutral' as const };
            const isFutura = c.id === realTenant.id;
            const needsAttention = c.status === 'pending' || c.status === 'onboarding';
            return (
              <div
                key={c.id}
                className={`rounded-2xl border bg-white p-5 transition-shadow hover:shadow-sm ${
                  needsAttention ? 'border-violet-200/70' : 'border-[--color-border]'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-zinc-900">{c.name}</h3>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      {isFutura && <Badge tone="success">Futura</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {c.slug} · creada el {fmtDate(c.createdAt)}
                    </p>
                  </div>
                  {!isFutura && (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {impersonating && c.id === actingTenant.id ? (
                        <Badge tone="violet">Gestionando ahora</Badge>
                      ) : (
                        <EnterButton tenantId={c.id} />
                      )}
                      <ActivateButton tenantId={c.id} active={c.status === 'active'} />
                    </div>
                  )}
                </div>

                {/* Módulos por clínica */}
                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-[--color-border-subtle] pt-4">
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
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
  tone: 'neutral' | 'success' | 'violet';
}) {
  const ring =
    tone === 'success' ? 'from-emerald-50' : tone === 'violet' ? 'from-violet-50' : 'from-zinc-50';
  return (
    <div className={`rounded-2xl border border-[--color-border] bg-gradient-to-br ${ring} to-white p-5`}>
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-zinc-900">{value}</p>
    </div>
  );
}
