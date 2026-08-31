import 'server-only';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getCurrentTenant } from '@/lib/tenant';
import {
  type EnabledModules,
  MODULE_DEFINITIONS,
  type ModuleKey,
  isModuleEnabled,
} from '@/lib/modules';
import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';

// Wrapper que muestra el contenido normal si el módulo está activo para el
// tenant actual, o un overlay de "no implementado" con el contenido blurreado
// debajo. Bloqueo solo visual: las APIs/webhooks siguen funcionando.
export async function ModuleGate({
  moduleKey,
  children,
}: {
  moduleKey: ModuleKey;
  children: ReactNode;
}) {
  const { tenant } = await getCurrentTenant();
  const enabled = isModuleEnabled(tenant.enabledModules as EnabledModules | null, moduleKey);

  if (enabled) return <>{children}</>;

  const def = MODULE_DEFINITIONS[moduleKey];

  return (
    <div className="relative min-h-[60vh]">
      <div aria-hidden className="pointer-events-none select-none opacity-35 blur-md">
        {children}
      </div>
      <div className="absolute inset-0 z-10 flex items-start justify-center pt-24">
        <Card className="mx-4 max-w-md animate-pop overflow-hidden p-7 text-center shadow-[var(--shadow-float)]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(139,92,246,0.16),transparent_70%)]"
          />
          <div className="relative">
            <div className="mx-auto mb-4 inline-flex h-14 w-14 animate-float items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#7139e8,#a855f7_60%,#ec4899)] text-white shadow-[0_14px_30px_-12px_rgba(113,57,232,0.9)]">
              <Lock className="h-6 w-6" />
            </div>
            <CardTitle className="text-xl">Módulo no incluido</CardTitle>
            <CardDescription className="mt-2 leading-relaxed">
              El módulo <span className="font-semibold text-zinc-700">{def.label}</span> no está
              activo para tu cuenta. Escribinos y lo dejamos andando.
            </CardDescription>
            <div className="mt-6">
              <Button asChild variant="primary" size="md">
                <a
                  href={`mailto:soporte@futuradigital.es?subject=${encodeURIComponent(
                    `Activar módulo ${def.label}`,
                  )}`}
                >
                  Contactar a soporte
                </a>
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
