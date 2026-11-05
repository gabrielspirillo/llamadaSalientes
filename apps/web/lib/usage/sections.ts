/**
 * Qué funcionalidad es cada pantalla del panel. Puro: lo usan el latido de
 * uso (para guardar la sección) y el panel de Futura (para pintarla).
 * El orden importa: la ruta más concreta primero.
 */

export interface UsageSection {
  key: string;
  label: string;
}

const RULES: { prefix: string; key: string; label: string }[] = [
  { prefix: '/dashboard/agenda/pacientes', key: 'patients', label: 'Fichas de pacientes' },
  { prefix: '/dashboard/agenda/profesionales', key: 'professionals', label: 'Profesionales' },
  { prefix: '/dashboard/agenda', key: 'agenda', label: 'Agenda' },
  { prefix: '/dashboard/whatsapp', key: 'whatsapp', label: 'WhatsApp' },
  { prefix: '/dashboard/messages', key: 'messages', label: 'Mensajes del equipo' },
  { prefix: '/dashboard/tasks', key: 'tasks', label: 'Tareas' },
  { prefix: '/dashboard/finanzas', key: 'finance', label: 'Finanzas' },
  { prefix: '/dashboard/analytics', key: 'analytics', label: 'Métricas' },
  { prefix: '/dashboard/calls', key: 'calls', label: 'Llamadas' },
  { prefix: '/dashboard/outbound', key: 'outbound', label: 'Llamadas salientes' },
  { prefix: '/dashboard/reminders', key: 'reminders', label: 'Recordatorios' },
  { prefix: '/dashboard/waitlist', key: 'waitlist', label: 'Lista de espera' },
  { prefix: '/dashboard/entrenamiento', key: 'training', label: 'Entrenar asistente' },
  { prefix: '/dashboard/agent', key: 'agent_test', label: 'Probar asistente' },
  { prefix: '/dashboard/treatments', key: 'treatments', label: 'Tratamientos' },
  { prefix: '/dashboard/faqs', key: 'faqs', label: 'Preguntas frecuentes' },
  { prefix: '/dashboard/contacts', key: 'contacts', label: 'Contactos' },
  { prefix: '/dashboard/settings', key: 'settings', label: 'Datos de la clínica' },
  { prefix: '/dashboard/configuration', key: 'configuration', label: 'Configuración' },
  { prefix: '/dashboard/team', key: 'team', label: 'Equipo' },
];

export const USAGE_SECTIONS: UsageSection[] = [
  { key: 'home', label: 'Inicio' },
  ...RULES.map(({ key, label }) => ({ key, label })),
  { key: 'other', label: 'Otras pantallas' },
];

const LABELS = new Map(USAGE_SECTIONS.map((s) => [s.key, s.label]));

/** La sección de una ruta, o null si no es del panel de una clínica (Futura, login…). */
export function sectionForPath(rawPath: string): string | null {
  const path = (rawPath.split(/[?#]/)[0] ?? '').replace(/\/+$/, '') || '/';
  if (!path.startsWith('/dashboard')) return null;
  if (path.startsWith('/dashboard/futura') || path.startsWith('/dashboard/whoami')) return null;
  if (path === '/dashboard') return 'home';
  for (const r of RULES) {
    if (path === r.prefix || path.startsWith(`${r.prefix}/`)) return r.key;
  }
  return 'other';
}

export function sectionLabel(key: string): string {
  return LABELS.get(key) ?? key;
}
