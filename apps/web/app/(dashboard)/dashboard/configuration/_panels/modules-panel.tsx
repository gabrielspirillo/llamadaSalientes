import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema';
import {
  type EnabledModules,
  FUTURA_TENANT_ID,
  MODULE_KEYS,
  MODULE_DEFINITIONS,
  isSuperAdminTenant,
} from '@/lib/modules';
import { getCurrentTenant } from '@/lib/tenant';
import { asc } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { ModuleToggle } from './modules-panel-toggle';

export async function ModulesPanel() {
  const { tenant } = await getCurrentTenant();
  // Defensa en profundidad: aunque la tab no se renderice para no-superadmin,
  // si alguien llega acá igual le devolvemos 404.
  if (!isSuperAdminTenant(tenant.id)) {
    notFound();
  }

  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      enabledModules: tenants.enabledModules,
    })
    .from(tenants)
    .orderBy(asc(tenants.name));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">Módulos por tenant</h2>
        <p className="text-sm text-zinc-500">
          Activar / desactivar módulos contratables. El bloqueo es visual: las APIs
          y webhooks siguen procesando aunque el módulo esté apagado.
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-200/70 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50/60 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3">Tenant</th>
              {MODULE_KEYS.map((key) => (
                <th key={key} className="px-4 py-3 text-center">
                  {MODULE_DEFINITIONS[key].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((row) => {
              const modules = (row.enabledModules ?? {}) as EnabledModules;
              const isDemo = row.id === FUTURA_TENANT_ID;
              return (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className="font-medium text-zinc-900">
                        {row.name}
                        {isDemo && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            demo
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-zinc-500">{row.slug}</span>
                    </div>
                  </td>
                  {MODULE_KEYS.map((key) => (
                    <td key={key} className="px-4 py-3 text-center">
                      <ModuleToggle
                        tenantId={row.id}
                        moduleKey={key}
                        initialEnabled={Boolean(modules[key])}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={MODULE_KEYS.length + 1}
                  className="px-4 py-8 text-center text-sm text-zinc-500"
                >
                  No hay tenants registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
