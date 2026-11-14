// Centro de avisos de la campana: lo puro (sin base), con tests en
// tests/unit/avisos.test.ts. Convierte las tarjetas del chat interno, las
// llamadas del agente, las fichas duplicadas y las tareas del día en una sola
// lista de avisos con acciones.

/** Qué pide el aviso. Decide icono, color y en qué pestaña sale. */
export type NoticeCategory =
  | 'call' // hay que llamar a alguien
  | 'person' // alguien pide hablar con una persona (WhatsApp)
  | 'duplicate' // fichas que parecen la misma persona
  | 'task' // tareas para hoy
  | 'agenda' // cambios de la agenda
  | 'info' // firmado, cumpleaños…
  | 'voice' // llamadas atendidas por el asistente
  | 'system'; // problemas del canal (sólo Futura)

/** Pide algo a alguien: sale en «Pendiente». El resto, en «Actividad». */
export const ACTIONABLE: ReadonlySet<NoticeCategory> = new Set([
  'call',
  'person',
  'duplicate',
  'task',
  'system',
]);

export type NoticeAction =
  | { kind: 'link'; label: string; href: string; primary?: boolean }
  | { kind: 'tel'; label: string; href: string; primary?: boolean }
  | { kind: 'to-task'; label: string; messageId: string };

export interface Notice {
  /** Clave estable: es lo que se guarda al descartar. */
  ref: string;
  category: NoticeCategory;
  title: string;
  detail: string;
  createdAt: string;
  /** A dónde lleva pulsar el aviso entero. */
  href: string | null;
  actions: NoticeAction[];
}

/** Eventos del chat interno que llegan a la campana, y como qué. */
export const EVENT_CATEGORY: Record<string, NoticeCategory> = {
  'call.missed': 'call',
  'call.transferred_unanswered': 'call',
  'reminder.no_response': 'call',
  'wa.handoff': 'person',
  'waitlist.book_failed': 'agenda',
  'appointment.cancelled': 'agenda',
  'appointment.no_show': 'agenda',
  'consent.signed': 'info',
  'patient.birthday': 'info',
  'wa.channel_problem': 'system',
};

export const NOTICE_EVENTS = Object.keys(EVENT_CATEGORY);

export interface EventRow {
  id: string;
  eventKey: string;
  body: string;
  contextPayload: Record<string, unknown>;
  actions: { id: string; label: string; href?: string; action?: string }[];
  createdAt: Date | string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Quita las líneas que ya dice el título o los botones (teléfono, «Cita:»). */
function cleanDetail(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^Teléfono:/i.test(l))
    .join(' · ')
    .slice(0, 220);
}

export function eventToNotice(row: EventRow): Notice | null {
  const category = EVENT_CATEGORY[row.eventKey];
  if (!category) return null;
  const p = row.contextPayload ?? {};
  const [firstLine = '', ...rest] = (row.body ?? '').split('\n');
  // «WhatsApp pide humano» es jerga del sistema: en la campana se dice claro.
  const title = (str(p.title) ?? firstLine.trim()).replace(
    /^WhatsApp pide humano/,
    'Quiere hablar con el equipo',
  );
  if (!title) return null;
  const detail = cleanDetail(str(p.detail) ?? rest.join('\n'));

  const actions: NoticeAction[] = [];
  let href: string | null = null;
  for (const a of row.actions ?? []) {
    if (a.action === 'message.to_task') {
      actions.push({ kind: 'to-task', label: 'Crear tarea', messageId: row.id });
    } else if (a.href?.startsWith('tel:')) {
      actions.push({ kind: 'tel', label: 'Llamar', href: a.href });
    } else if (a.href?.startsWith('/')) {
      href ??= a.href;
      actions.push({ kind: 'link', label: a.label, href: a.href });
    }
  }
  // Lo que más se usa va primero: llamar en lo que pide llamar, abrir en el resto.
  const order = (a: NoticeAction) =>
    a.kind === 'tel' ? (category === 'call' ? 0 : 2) : a.kind === 'link' ? 1 : 3;
  const sorted = actions
    .sort((a, b) => order(a) - order(b))
    .filter(
      // Un enlace por aviso basta (el aviso entero ya lleva al primero).
      (a, i, all) => a.kind !== 'link' || all.findIndex((x) => x.kind === 'link') === i,
    )
    .slice(0, 3);
  const first = sorted[0];
  if (first && first.kind !== 'to-task') sorted[0] = { ...first, primary: true };

  return {
    ref: `im:${row.id}`,
    category,
    title,
    detail,
    createdAt: new Date(row.createdAt).toISOString(),
    href,
    actions: sorted,
  };
}

/** Nombre comparable: sin tildes, minúsculas y espacios simples. */
export function foldName(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Grupos de fichas con el mismo nombre (dos o más). */
export function duplicateGroups<T extends { id: string; name: string }>(rows: T[]): T[][] {
  const byName = new Map<string, T[]>();
  for (const r of rows) {
    const k = foldName(r.name);
    if (k.length < 3) continue;
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }
  return [...byName.values()].filter((g) => g.length > 1);
}

/** Hash corto y estable: el aviso de duplicados vuelve sólo si cambian los grupos. */
export function shortHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

export function duplicatesNotice(
  groups: { id: string; name: string }[][],
  now: Date,
): Notice | null {
  if (groups.length === 0) return null;
  const ids = groups
    .flatMap((g) => g.map((r) => r.id))
    .sort()
    .join(',');
  const names = groups.slice(0, 3).map((g) => g[0]?.name ?? '');
  const more = groups.length - names.length;
  return {
    ref: `dup:${shortHash(ids)}`,
    category: 'duplicate',
    title:
      groups.length === 1
        ? `${groups[0]?.length ?? 2} fichas parecen la misma persona`
        : `${groups.length} pacientes tienen la ficha duplicada`,
    detail: `${names.join(', ')}${more > 0 ? ` y ${more} más` : ''}. Únelas para que la historia no quede repartida.`,
    createdAt: now.toISOString(),
    href: '/dashboard/agenda/pacientes',
    actions: [
      { kind: 'link', label: 'Revisar', href: '/dashboard/agenda/pacientes', primary: true },
    ],
  };
}

export function tasksNotice(
  counts: { today: number; overdue: number },
  dayKey: string,
  now: Date,
): Notice | null {
  const total = counts.today + counts.overdue;
  if (total === 0) return null;
  const parts = [
    counts.today > 0 ? `${counts.today} para hoy` : null,
    counts.overdue > 0
      ? `${counts.overdue} ${counts.overdue === 1 ? 'vencida' : 'vencidas'}`
      : null,
  ].filter(Boolean);
  return {
    ref: `tasks:${dayKey}:${counts.today}:${counts.overdue}`,
    category: 'task',
    title: total === 1 ? 'Tienes una tarea pendiente' : `Tienes ${total} tareas pendientes`,
    detail: parts.join(' · '),
    createdAt: now.toISOString(),
    href: '/dashboard/tasks',
    actions: [{ kind: 'link', label: 'Ver tareas', href: '/dashboard/tasks', primary: true }],
  };
}

/** Lo que pide algo va primero; dentro de cada bloque, lo más reciente. */
export function sortNotices(items: Notice[]): Notice[] {
  return [...items].sort((a, b) => {
    const pa = ACTIONABLE.has(a.category) ? 0 : 1;
    const pb = ACTIONABLE.has(b.category) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return b.createdAt.localeCompare(a.createdAt);
  });
}
