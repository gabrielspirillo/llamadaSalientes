import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { getCurrentTenant } from '@/lib/tenant';
import { auth } from '@clerk/nextjs/server';
import { IdCard } from 'lucide-react';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Info de cuenta · FUTURA' };

// Página de diagnóstico: muestra los identificadores de TU propia cuenta/clínica.
// Sirve para configurar el super-admin (FUTURA_TENANT_ID) sin adivinar el UUID.
// No expone datos de otras clínicas: solo los de tu propio tenant.
export default async function WhoamiPage() {
  const ctx = await getCurrentTenant();
  // realTenant = tu tenant real (aunque estés impersonando).
  const t = ctx.realTenant ?? ctx.tenant;
  const a = await auth();
  const orgId = a.orgId ?? null;
  const orgSlug = a.orgSlug ?? null;

  const rows: { k: string; v: string | null; hint?: string }[] = [
    { k: 'Tenant ID', v: t.id, hint: 'Este valor va en la variable de entorno FUTURA_TENANT_ID' },
    { k: 'Slug', v: t.slug },
    { k: 'Nombre', v: t.name },
    { k: 'Estado', v: t.status },
    { k: 'Clerk Org ID', v: orgId }, // ya normalizado a string | null
    { k: 'Clerk Org Slug', v: orgSlug ?? '—' },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Cuenta"
        icon={<IdCard className="h-5 w-5" />}
        title="Info de cuenta"
        description="Identificadores técnicos de tu cuenta (para configurar la plataforma)."
      />

      <div className="mb-5 flex items-center gap-2">
        <span className="text-sm text-zinc-600">Super-admin (Panel Futura):</span>
        {ctx.isSuperAdmin ? (
          <Badge tone="success">Activo</Badge>
        ) : (
          <Badge tone="warn">No reconocido</Badge>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-[--color-border] bg-white">
        <dl className="divide-y divide-[--color-border-subtle]">
          {rows.map((r) => (
            <div
              key={r.k}
              className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-center sm:gap-4"
            >
              <dt className="w-40 shrink-0 text-sm text-zinc-500">{r.k}</dt>
              <dd className="min-w-0">
                <code className="break-all rounded bg-zinc-50 px-2 py-1 text-sm text-zinc-800 ring-1 ring-inset ring-zinc-200">
                  {r.v ?? '—'}
                </code>
                {r.hint && <p className="mt-1 text-xs text-brand-600">{r.hint}</p>}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {!ctx.isSuperAdmin && (
        <div className="mt-5 rounded-2xl border border-brand-200 bg-brand-50/60 p-5 text-sm text-zinc-700">
          <p className="font-medium text-zinc-900">Para habilitar el Panel Futura</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Copia el <span className="font-medium">Tenant ID</span> de arriba.
            </li>
            <li>
              En Dokploy → servicio <span className="font-mono">cliniq-web</span> → Environment,
              añade <span className="font-mono">FUTURA_TENANT_ID=&lt;ese id&gt;</span>.
            </li>
            <li>Vuelve a desplegar y recarga esta página: “Super-admin” debe aparecer “Activo”.</li>
          </ol>
        </div>
      )}
    </>
  );
}
