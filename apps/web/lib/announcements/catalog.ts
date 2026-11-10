/**
 * Novedades del panel: avisos que se le enseñan a cada persona una vez, en un
 * pop-up, para contarle una función nueva o un cambio en cómo se trabaja.
 *
 * El catálogo va en el código (un aviso es copy y diseño, se revisa como
 * cualquier cambio de UI); lo que cada persona hizo con él va en
 * `announcement_views`. "Entendido" no lo vuelve a mostrar; "Recordar más
 * tarde" (o cerrarlo) lo vuelve a mostrar pasadas `SNOOZE_HOURS`.
 *
 * Para añadir uno: una entrada nueva aquí con un `id` que no se haya usado
 * nunca (el id es la memoria de quién lo vio) y, si lleva ilustración, su
 * `visual` en `components/dashboard/announcement-center.tsx`.
 */

export type AnnouncementVisual = 'status-completed';

export interface Announcement {
  id: string;
  /** Desde cuándo sale (ISO). Antes, no. */
  publishedAt: string;
  /** Hasta cuándo sale (ISO). Pasada la fecha, no se enseña a nadie más. */
  expiresAt?: string;
  /** `care_profile`: sólo clínicas con perfil de atención (Respinens). */
  audience: 'all' | 'care_profile';
  /** Sólo en estas rutas (prefijo). Sin lista, en cualquier página del panel. */
  paths?: string[];
  eyebrow: string;
  title: string;
  body: string;
  bullets?: string[];
  visual?: AnnouncementVisual;
}

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'agenda-estado-atendida-2026-11',
    publishedAt: '2026-11-10T00:00:00Z',
    expiresAt: '2027-01-31T00:00:00Z',
    audience: 'care_profile',
    paths: ['/dashboard/agenda'],
    eyebrow: 'Novedad en tu agenda',
    title: 'Marca cada sesión como «Atendida»',
    body: 'Cuando termines una sesión, abre la cita y pulsa Atendida. Así la agenda distingue de un vistazo lo que ya se hizo de lo que está por venir.',
    bullets: [
      '«Agendada» es sólo para citas que todavía no han pasado.',
      'La sesión atendida queda en gris en el calendario.',
      'También lo tienes en la ficha del peque, en la tarjeta «Hoy».',
    ],
    visual: 'status-completed',
  },
];

export const SNOOZE_HOURS = 3;

export interface AnnouncementState {
  announcementId: string;
  status: 'DISMISSED' | 'SNOOZED';
  snoozeUntil: Date | null;
}

/** Avisos que le tocan ahora a esta persona, en el orden del catálogo. */
export function pendingAnnouncements(
  catalog: Announcement[],
  ctx: { hasCareProfile: boolean; now: Date },
  states: AnnouncementState[],
): Announcement[] {
  const byId = new Map(states.map((s) => [s.announcementId, s]));
  const now = ctx.now.getTime();
  return catalog.filter((a) => {
    if (Date.parse(a.publishedAt) > now) return false;
    if (a.expiresAt && Date.parse(a.expiresAt) <= now) return false;
    if (a.audience === 'care_profile' && !ctx.hasCareProfile) return false;
    const st = byId.get(a.id);
    if (!st) return true;
    if (st.status === 'DISMISSED') return false;
    return !st.snoozeUntil || st.snoozeUntil.getTime() <= now;
  });
}

/** El aviso se enseña en esta ruta. */
export function matchesPath(a: Pick<Announcement, 'paths'>, pathname: string): boolean {
  if (!a.paths?.length) return true;
  return a.paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function snoozeUntil(now: Date): Date {
  return new Date(now.getTime() + SNOOZE_HOURS * 3_600_000);
}

export function findAnnouncement(id: string): Announcement | null {
  return ANNOUNCEMENTS.find((a) => a.id === id) ?? null;
}
