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
      <div
        aria-hidden
        className="pointer-events-none select-none blur-md opacity-40"
      >
        {children}
      </div>
      <div className="absolute inset-0 z-10 flex items-start justify-center pt-24">
        <Card className="mx-4 max-w-md p-6 text-center shadow-lg">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-700">
            <Lock className="h-5 w-5" />
          </div>
          <CardTitle className="text-lg">Funcionalidad no implementada</CardTitle>
          <CardDescription className="mt-2">
            El módulo <span className="font-medium text-zinc-700">{def.label}</span> no está
            activo para tu cuenta. Contactá a soporte para implementarlo.
          </CardDescription>
          <div className="mt-5">
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
        </Card>
      </div>
    </div>
  );
}
