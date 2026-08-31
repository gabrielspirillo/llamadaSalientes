// Catálogo de módulos contratables por tenant. Fase 1: bloqueo solo visual.
// Source-of-truth de la columna `tenants.enabled_modules` (jsonb).

export type ModuleKey = 'whatsapp' | 'outbound' | 'inbound';

export const MODULE_DEFINITIONS: Record<
  ModuleKey,
  {
    label: string;
    description: string;
    // Rutas (prefijos) que pertenecen al módulo. Se usan para gate del sidebar.
    routes: string[];
  }
> = {
  whatsapp: {
    label: 'WhatsApp',
    description: 'Inbox de mensajes WhatsApp + agente automático',
    routes: ['/dashboard/whatsapp'],
  },
  outbound: {
    label: 'Llamadas Salientes',
    description: 'Campañas de llamadas salientes con agente de voz',
    routes: ['/dashboard/outbound'],
  },
  inbound: {
    label: 'Llamadas Entrantes',
    description: 'Recepción de llamadas con agente de voz + transferencias',
    routes: ['/dashboard/calls'],
  },
};

export const MODULE_KEYS = Object.keys(MODULE_DEFINITIONS) as ModuleKey[];

export type EnabledModules = Record<ModuleKey, boolean>;

export const DEFAULT_ENABLED_MODULES: EnabledModules = {
  whatsapp: false,
  outbound: false,
  inbound: false,
};

export function isModuleEnabled(
  modules: EnabledModules | null | undefined,
  key: ModuleKey,
): boolean {
  return Boolean(modules?.[key]);
}

// Devuelve la key del módulo al que pertenece una ruta del sidebar, o null si la
// ruta es "core" (siempre disponible).
export function moduleForRoute(href: string): ModuleKey | null {
  for (const key of MODULE_KEYS) {
    const def = MODULE_DEFINITIONS[key];
    if (def.routes.some((r) => href === r || href.startsWith(`${r}/`))) {
      return key;
    }
  }
  return null;
}

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && (MODULE_KEYS as string[]).includes(value);
}

// Tenant Futura Solutions = demo. Único super-admin en fase 1.
// Cualquier miembro de esta org Clerk puede togglear módulos de cualquier tenant.
// ID del tenant de Futura (super-admin). Configurable por env para no depender
// de un UUID hardcodeado: si en producción el tenant de Futura tiene otro id,
// se setea FUTURA_TENANT_ID en Dokploy sin tocar código.
export const FUTURA_TENANT_ID =
  process.env.FUTURA_TENANT_ID?.trim() ||
  // Fail-CLOSED en producción: sin env explícita no hay super-admin (evita que
  // un UUID de seed dev otorgue god-mode). El fallback dev/test es solo local.
  (process.env.NODE_ENV === 'production' ? '' : 'f6c01830-6a8b-44e3-8cfb-38bee10a2b10');

export function isSuperAdminTenant(tenantId: string): boolean {
  return FUTURA_TENANT_ID !== '' && tenantId === FUTURA_TENANT_ID;
}
