'use client';

import { useMessaging } from '@/components/messaging/MessagingProvider';
import type { Branding } from '@/lib/branding';
import { cn } from '@/lib/cn';
import { type EnabledModules, isModuleEnabled, moduleForRoute } from '@/lib/modules';
import { OrganizationSwitcher } from '@clerk/nextjs';
import {
  BarChart3,
  BellRing,
  Bot,
  Building2,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Contact,
  FolderOpen,
  Headset,
  HelpCircle,
  Home,
  LayoutDashboard,
  ListChecks,
  Lock,
  MessageCircle,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PhoneCall,
  PhoneOutgoing,
  Settings,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { useEffect } from 'react';

/** Color del chip del icono cuando el ítem está activo. */
type Tone = 'brand' | 'blossom' | 'mint' | 'sky' | 'honey' | 'coral';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  tone: Tone;
};

/**
 * Grupo que NO ocupa sitio en la barra: es una sola fila que abre un menú
 * flotante al lado (o se despliega hacia abajo en el cajón del móvil).
 */
type NavGroup = {
  id: string;
  label: string;
  icon: LucideIcon;
  tone: Tone;
  items: readonly NavItem[];
};

type NavEntry = { kind: 'link'; item: NavItem } | { kind: 'group'; group: NavGroup };

/**
 * Menú principal.
 *
 * Sólo son fila propia las cinco pantallas del día a día. Lo demás —los
 * canales, las fichas y la configuración de la clínica— vive en un menú
 * flotante: la barra entera cabe sin scroll, que era el problema.
 */
const ENTRIES: readonly NavEntry[] = [
  { kind: 'link', item: { href: '/dashboard', label: 'Panel', icon: Home, tone: 'brand' } },
  {
    kind: 'link',
    item: { href: '/dashboard/agenda', label: 'Agenda', icon: CalendarDays, tone: 'mint' },
  },
  {
    kind: 'link',
    item: { href: '/dashboard/whatsapp', label: 'WhatsApp', icon: MessageCircle, tone: 'mint' },
  },
  {
    kind: 'link',
    item: { href: '/dashboard/messages', label: 'Mensajes', icon: MessageSquare, tone: 'brand' },
  },
  {
    kind: 'link',
    item: { href: '/dashboard/tasks', label: 'Tareas', icon: ClipboardCheck, tone: 'blossom' },
  },
  {
    kind: 'link',
    item: { href: '/dashboard/analytics', label: 'Métricas', icon: BarChart3, tone: 'sky' },
  },
  {
    kind: 'group',
    group: {
      id: 'canales',
      label: 'Canales',
      icon: Headset,
      tone: 'brand',
      items: [
        { href: '/dashboard/calls', label: 'Llamadas', icon: PhoneCall, tone: 'brand' },
        {
          href: '/dashboard/outbound',
          label: 'Llamadas salientes',
          icon: PhoneOutgoing,
          tone: 'blossom',
        },
        { href: '/dashboard/reminders', label: 'Recordatorios', icon: BellRing, tone: 'honey' },
        { href: '/dashboard/waitlist', label: 'Lista de espera', icon: ListChecks, tone: 'coral' },
      ],
    },
  },
  {
    kind: 'group',
    group: {
      id: 'registros',
      label: 'Registros',
      icon: FolderOpen,
      tone: 'sky',
      items: [
        { href: '/dashboard/contacts', label: 'Pacientes', icon: Contact, tone: 'sky' },
        { href: '/dashboard/treatments', label: 'Tratamientos', icon: Stethoscope, tone: 'mint' },
        { href: '/dashboard/faqs', label: 'Preguntas frecuentes', icon: HelpCircle, tone: 'honey' },
        { href: '/dashboard/team', label: 'Equipo', icon: Users, tone: 'blossom' },
      ],
    },
  },
  {
    kind: 'group',
    group: {
      id: 'clinica',
      label: 'Clínica',
      icon: Building2,
      tone: 'honey',
      items: [
        { href: '/dashboard/agent', label: 'Asistente', icon: Bot, tone: 'brand' },
        { href: '/dashboard/settings', label: 'Datos de la clínica', icon: Building2, tone: 'sky' },
      ],
    },
  },
] as const;

/**
 * Menú de un profesional con acceso restringido: su agenda y nada más.
 *
 * Es sólo lo que se DIBUJA. El bloqueo de verdad está en el servidor — el
 * layout redirige y `requireTaskRole` rechaza las escrituras del resto del
 * panel—: esconder un enlace nunca ha protegido nada.
 */
const AGENDA_ONLY_ENTRIES: readonly NavEntry[] = [
  {
    kind: 'link',
    item: { href: '/dashboard/agenda', label: 'Mi agenda', icon: CalendarDays, tone: 'mint' },
  },
] as const;

const ICON_TONE: Record<Tone, string> = {
  brand: 'bg-brand-100 text-brand-700',
  blossom: 'bg-emerald-100 text-emerald-600',
  mint: 'bg-emerald-100 text-emerald-600',
  sky: 'bg-sky-100 text-sky-600',
  honey: 'bg-amber-100 text-amber-600',
  coral: 'bg-rose-100 text-rose-600',
};

/* Todas las filas del menú comparten forma: enlaces, grupos y el pie. */
const ROW_BASE =
  'group relative flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left text-[14px] font-medium transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]';
const ROW_IDLE = 'text-zinc-600 hover:translate-x-0.5 hover:bg-white/70 hover:text-zinc-900';
const ROW_ACTIVE = 'bg-white text-zinc-900 shadow-[0_8px_20px_-12px_rgba(20,33,29,0.45)]';

function isActive(pathname: string, href: string) {
  return href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);
}

/**
 * Dónde se dibuja la fila. Cambia dos cosas: la barra de acento —sólo la lleva
 * el primer nivel de la barra, dentro de un submenú caería fuera— y el fondo
 * del chip apagado, que en el menú flotante sería blanco sobre blanco.
 *
 * `rail` primer nivel · `nested` desplegable del móvil · `panel` flotante.
 */
type Surface = 'rail' | 'nested' | 'panel';

/** Chip del icono. Se colorea sólo cuando la fila está activa o abierta. */
function IconChip({
  icon: Icon,
  tone,
  active,
  surface = 'rail',
}: {
  icon: LucideIcon;
  tone: Tone;
  active: boolean;
  surface?: Surface;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-300 group-hover:scale-110',
        active
          ? ICON_TONE[tone]
          : surface === 'panel'
            ? 'bg-zinc-100 text-zinc-500 group-hover:bg-zinc-200 group-hover:text-zinc-700'
            : 'bg-white/70 text-zinc-500 group-hover:bg-white group-hover:text-zinc-700',
      )}
    >
      <Icon className="h-[17px] w-[17px]" />
    </span>
  );
}

/** Barra de acento a la izquierda de la fila activa. */
function ActiveRail({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute -left-2 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-[linear-gradient(180deg,#37766a,#6bc2a4)] transition-all duration-300',
        active ? 'opacity-100' : 'scale-y-0 opacity-0',
      )}
    />
  );
}

/**
 * Rótulo flotante del modo plegado.
 *
 * Con la barra encogida sólo se ve el icono, así que sin esto no hay forma de
 * saber qué es cada fila. Los grupos no lo necesitan: al pasar por encima ya
 * abren su menú, que va encabezado por el nombre del grupo.
 *
 * Es puramente visual (`aria-hidden`): el nombre accesible de la fila va en su
 * `aria-label`, porque el rótulo de verdad lo borra el CSS con `display:none`.
 */
function HoverLabel({
  text,
  anchorRef,
  show,
}: {
  text: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  show: boolean;
}) {
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);

  React.useLayoutEffect(() => {
    if (!show) {
      setPos(null);
      return;
    }
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: Math.round(r.top + r.height / 2), left: Math.round(r.right + 12) });
  }, [show, anchorRef]);

  if (!show || !pos) return null;
  return (
    <span
      aria-hidden
      style={{ top: pos.top, left: pos.left }}
      className="pointer-events-none fixed z-50 -translate-y-1/2 animate-zoom-in whitespace-nowrap rounded-xl border border-[#dfe4e2] bg-white px-3 py-1.5 text-[13px] font-medium text-zinc-800 shadow-[0_18px_40px_-20px_rgba(20,33,29,0.55)]"
    >
      {text}
    </span>
  );
}

/**
 * Memoizado: el sidebar se re-renderiza cada vez que cambia el contador de
 * Mensajes (que llega por SSE). Sin esto se rehacían todos los enlaces y el
 * OrganizationSwitcher de Clerk en cada evento, aunque sólo cambiara un número.
 */
const NavLink = React.memo(function NavLink({
  item,
  active,
  locked,
  onNavigate,
  tourAnchor,
  badge = 0,
  badgeLabel,
  surface = 'rail',
  collapsed = false,
}: {
  item: NavItem;
  active: boolean;
  locked: boolean;
  onNavigate?: () => void;
  tourAnchor?: string;
  /** Contador que se dibuja a la derecha (0 = nada). */
  badge?: number;
  /** Texto accesible del contador. Sin esto el aria-label decía "tareas". */
  badgeLabel?: string;
  /** Dónde vive la fila: la barra lateral o el menú flotante. */
  surface?: Surface;
  /** Barra plegada: sin rótulo a la vista, hace falta uno flotante. */
  collapsed?: boolean;
}) {
  const ref = React.useRef<HTMLAnchorElement>(null);
  const [hovered, setHovered] = React.useState(false);

  // Los atributos del modo plegado sólo los lleva la fila que vive EN la barra.
  // El menú flotante es descendiente del <aside> aunque se dibuje fuera, así
  // que si sus enlaces los llevaran también, plegar la barra les borraría el
  // rótulo y dejaría un panel de iconos sin nombre.
  const enLaBarra = surface === 'rail';
  const attrPlegado = enLaBarra ? '' : undefined;

  // Plegada, el CSS borra rótulo, contador y candado con `display:none`, que
  // también los saca del árbol de accesibilidad. El nombre va aquí para que la
  // fila se anuncie igual en los dos estados.
  const nombreAccesible = [
    item.label,
    badge > 0 ? (badgeLabel ?? `${badge} pendientes`) : null,
    locked ? 'módulo no contratado' : null,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Link
      ref={ref}
      href={item.href}
      data-tour={tourAnchor}
      data-sidebar-row={attrPlegado}
      onClick={onNavigate}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      aria-current={active ? 'page' : undefined}
      aria-label={nombreAccesible}
      className={cn(ROW_BASE, active ? ROW_ACTIVE : ROW_IDLE)}
    >
      {surface === 'rail' && <ActiveRail active={active} />}
      <span className="relative shrink-0">
        <IconChip icon={item.icon} tone={item.tone} active={active} surface={surface} />
        {/* Plegada no cabe el número: queda el punto. */}
        {badge > 0 && (
          <span
            data-sidebar-only={attrPlegado}
            aria-hidden
            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-brand-600 ring-2 ring-[#ecefee]"
          />
        )}
      </span>
      <span data-sidebar-hide={attrPlegado} className="flex-1 truncate">
        {item.label}
      </span>
      {badge > 0 && (
        <span
          data-sidebar-hide={attrPlegado}
          aria-hidden
          className="inline-flex min-w-[20px] shrink-0 items-center justify-center rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {locked && (
        <Lock
          data-sidebar-hide={attrPlegado}
          aria-hidden
          className="h-3 w-3 shrink-0 text-zinc-400"
        />
      )}
      <HoverLabel text={item.label} anchorRef={ref} show={collapsed && hovered} />
    </Link>
  );
});

/**
 * Fila de un grupo.
 *
 * En el escritorio (`flyout`) abre una tarjeta flotante al lado de la barra:
 * con el ratón encima, con clic y con teclado. En el cajón del móvil (`inline`)
 * se despliega hacia abajo, porque a la derecha no hay sitio.
 *
 * La tarjeta se posiciona con `position: fixed` a partir del rectángulo del
 * botón: dentro del `<nav>`, que puede desbordar, cualquier otra cosa quedaría
 * recortada.
 */
function NavGroupRow({
  group,
  pathname,
  mode,
  enabledModules,
  onNavigate,
  anchorTour = false,
}: {
  group: NavGroup;
  pathname: string;
  mode: 'flyout' | 'inline';
  enabledModules: EnabledModules;
  onNavigate?: () => void;
  anchorTour?: boolean;
}) {
  const hasActive = group.items.some((it) => isActive(pathname, it.href));
  const [open, setOpen] = React.useState(mode === 'inline' && hasActive);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelId = `nav-grupo-${group.id}`;

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  // Cierra con retardo: entre el botón y la tarjeta hay un hueco, y sin margen
  // el menú se cerraría al cruzarlo con el ratón.
  const scheduleClose = React.useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  }, [cancelClose]);

  React.useEffect(() => cancelClose, [cancelClose]);

  // Al navegar, el flotante se cierra; el desplegable del móvil se abre solo si
  // la ruta activa está dentro.
  const itemsKey = group.items.map((it) => it.href).join(' ');
  React.useEffect(() => {
    if (mode === 'flyout') setOpen(false);
    else setOpen(itemsKey.split(' ').some((href) => isActive(pathname, href)));
  }, [pathname, mode, itemsKey]);

  const place = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const height = panelRef.current?.offsetHeight ?? group.items.length * 44 + 46;
    const top = Math.max(12, Math.min(r.top - 10, window.innerHeight - height - 12));
    const left = Math.round(r.right + 12);
    setPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
  }, [group.items.length]);

  React.useLayoutEffect(() => {
    if (mode !== 'flyout' || !open) return;
    place();
    window.addEventListener('resize', place);
    // En captura: así también se recoloca si el que se desplaza es el <nav>.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [mode, open, place]);

  React.useEffect(() => {
    if (mode !== 'flyout' || !open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [mode, open]);

  const links = group.items.map((it) => {
    const moduleKey = moduleForRoute(it.href);
    return (
      <NavLink
        key={it.href}
        item={it}
        active={isActive(pathname, it.href)}
        locked={moduleKey !== null && !isModuleEnabled(enabledModules, moduleKey)}
        surface={mode === 'flyout' ? 'panel' : 'nested'}
        onNavigate={() => {
          setOpen(false);
          onNavigate?.();
        }}
      />
    );
  });

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={
        mode === 'flyout'
          ? () => {
              cancelClose();
              setOpen(true);
            }
          : undefined
      }
      onMouseLeave={mode === 'flyout' ? scheduleClose : undefined}
      onBlurCapture={(e) => {
        if (mode !== 'flyout') return;
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        // El tutorial señala ítems por su href. Los que viven aquí dentro no
        // están en el DOM con el menú cerrado: que apunte al grupo que los tiene.
        data-tour-group={anchorTour ? itemsKey : undefined}
        data-sidebar-row
        onClick={() => setOpen((v) => !v)}
        aria-label={group.label}
        className={cn(ROW_BASE, hasActive || open ? ROW_ACTIVE : ROW_IDLE)}
      >
        <ActiveRail active={hasActive} />
        <IconChip icon={group.icon} tone={group.tone} active={hasActive || open} />
        <span data-sidebar-hide className="flex-1 truncate">
          {group.label}
        </span>
        <ChevronRight
          aria-hidden
          data-sidebar-hide
          className={cn(
            'h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-300',
            mode === 'inline' && open && 'rotate-90',
            mode === 'flyout' && open && 'translate-x-0.5 text-zinc-600',
          )}
        />
      </button>

      {open &&
        (mode === 'flyout' ? (
          <div
            ref={panelRef}
            id={panelId}
            style={{
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="fixed z-50 w-[244px] animate-zoom-in rounded-[22px] border border-[#dfe4e2] bg-white/95 p-1.5 shadow-[0_28px_70px_-28px_rgba(20,33,29,0.55)] backdrop-blur-xl"
          >
            <p className="px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-400">
              {group.label}
            </p>
            <div className="space-y-0.5">{links}</div>
          </div>
        ) : (
          <div id={panelId} className="ml-5 mt-0.5 space-y-0.5 border-l border-[#dfe4e2] pl-3">
            {links}
          </div>
        ))}
    </div>
  );
}

/**
 * Marca del panel.
 *
 * Por defecto la de FUTURA: nombre + punto verde, como siempre. Si Futura le
 * puso un logo propio a esta clínica, manda el suyo — es el white-label. Sin
 * logo NO se sustituye por el nombre de la clínica: el producto sigue siendo
 * Futura, y el nombre ya se lee justo debajo, en el selector de organizaciones.
 */
function BrandMark({ branding }: { branding?: Branding }) {
  if (branding?.logoUrl) {
    return (
      // <img> a pelo: el dominio del bucket es configurable por entorno y
      // next/image obligaría a declararlo en next.config.
      <img
        src={branding.logoUrl}
        alt={branding.name}
        className="h-9 w-auto max-w-[168px] object-contain object-left"
      />
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-[21px] font-extrabold leading-none tracking-tight text-[#0f1f2e]">
        FUTURA
      </span>
      <span className="inline-block h-2 w-2 rounded-full bg-[#5fa896]" />
    </span>
  );
}

function SidebarNav({
  onNavigate,
  enabledModules,
  isSuperAdmin = false,
  branding,
  anchorTour = false,
  tasksBadge = 0,
  messagesBadge = 0,
  agendaOnly = false,
  groupMode = 'flyout',
  collapsible = false,
}: {
  onNavigate?: () => void;
  enabledModules: EnabledModules;
  isSuperAdmin?: boolean;
  /** Profesional que sólo tiene acceso a su agenda. */
  agendaOnly?: boolean;
  /** Marca de la clínica activa. Sin logo se dibuja la de FUTURA. */
  branding?: Branding;
  anchorTour?: boolean;
  /** Tareas mías vencidas o para hoy. 0 = no se muestra nada. */
  tasksBadge?: number;
  /** Mensajes sin leer. Hidrata del server y a partir de ahí manda el stream. */
  messagesBadge?: number;
  /** Cómo se abren los grupos: flotante (escritorio) o desplegable (móvil). */
  groupMode?: 'flyout' | 'inline';
  /** Sólo la barra fija del escritorio se pliega; el cajón del móvil no. */
  collapsible?: boolean;
}) {
  const pathname = usePathname();
  // El contador del server hidrata; después manda el stream del provider.
  const messaging = useMessaging();
  const liveMessages = messaging.ready ? messaging.totalUnread : messagesBadge;

  // Plegado: la verdad vive en el atributo del <html> que puso el script en
  // línea antes de pintar. React lo lee al montar y sólo lo usa para el icono
  // del botón y para saber si hacen falta los rótulos flotantes; de la anchura
  // y del texto se encarga el CSS, que ya está aplicado en el primer frame.
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    setCollapsed(document.documentElement.dataset.sidebar === 'collapsed');
  }, []);
  const toggleCollapsed = React.useCallback(() => {
    const next = document.documentElement.dataset.sidebar !== 'collapsed';
    document.documentElement.dataset.sidebar = next ? 'collapsed' : 'expanded';
    try {
      localStorage.setItem('futura:sidebar', next ? 'collapsed' : 'expanded');
    } catch {
      // Navegador sin almacenamiento: se pliega igual, no se recuerda.
    }
    setCollapsed(next);
  }, []);

  return (
    <>
      {/* --- Marca ---------------------------------------------------------- */}
      <div data-sidebar-header className="flex h-[68px] items-center justify-between gap-2 px-5">
        <Link
          data-sidebar-hide
          href="/dashboard"
          onClick={onNavigate}
          aria-label={branding?.name ?? 'FUTURA'}
        >
          <BrandMark branding={branding} />
        </Link>
        {collapsible && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Desplegar el menú' : 'Plegar el menú'}
            aria-pressed={collapsed}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition-all duration-300 hover:bg-white hover:text-zinc-900"
          >
            <PanelLeftClose data-sidebar-hide aria-hidden className="h-[18px] w-[18px]" />
            <PanelLeftOpen data-sidebar-only aria-hidden className="h-[18px] w-[18px]" />
          </button>
        )}
        {onNavigate && (
          <button
            type="button"
            onClick={onNavigate}
            aria-label="Cerrar menú"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-zinc-500 transition-all hover:rotate-90 hover:bg-white hover:text-zinc-900 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* --- Selector de organización -------------------------------------- */}
      <div data-sidebar-hide className="px-3 pb-1 pt-1">
        <OrganizationSwitcher
          hidePersonal
          afterCreateOrganizationUrl="/dashboard"
          afterSelectOrganizationUrl="/dashboard"
          appearance={{
            elements: {
              rootBox: 'w-full',
              organizationSwitcherTrigger:
                'w-full justify-between rounded-2xl border border-white/80 bg-white/80 px-3 py-2.5 text-sm backdrop-blur-xl transition-all hover:bg-white hover:shadow-[0_8px_20px_-14px_rgba(20,33,29,0.5)]',
            },
          }}
        />
      </div>

      {/* --- Navegación ----------------------------------------------------- */}
      <nav className="scrollbar-none flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        {(agendaOnly ? AGENDA_ONLY_ENTRIES : ENTRIES).map((entry) => {
          if (entry.kind === 'group') {
            return (
              <NavGroupRow
                key={entry.group.id}
                group={entry.group}
                pathname={pathname}
                mode={groupMode}
                enabledModules={enabledModules}
                onNavigate={onNavigate}
                anchorTour={anchorTour}
              />
            );
          }
          const it = entry.item;
          const moduleKey = moduleForRoute(it.href);
          return (
            <NavLink
              key={it.href}
              item={it}
              active={isActive(pathname, it.href)}
              locked={moduleKey !== null && !isModuleEnabled(enabledModules, moduleKey)}
              onNavigate={onNavigate}
              collapsed={collapsed}
              tourAnchor={anchorTour ? it.href : undefined}
              badge={
                it.href === '/dashboard/tasks'
                  ? tasksBadge
                  : it.href === '/dashboard/messages'
                    ? liveMessages
                    : 0
              }
              badgeLabel={
                it.href === '/dashboard/tasks'
                  ? `${tasksBadge} tareas para hoy o vencidas`
                  : it.href === '/dashboard/messages'
                    ? `${liveMessages} mensajes sin leer`
                    : undefined
              }
            />
          );
        })}
      </nav>

      {/* --- Pie: ajustes de la cuenta. Mismo fondo que el resto de la barra;
             lo único que lo separa es una línea. --------------------------- */}
      <div className="mt-auto shrink-0 space-y-0.5 border-t border-[#dfe4e2] px-3 pb-3 pt-2">
        {isSuperAdmin && (
          <NavLink
            item={{
              href: '/dashboard/futura',
              label: 'Panel Futura',
              icon: LayoutDashboard,
              tone: 'brand',
            }}
            active={pathname.startsWith('/dashboard/futura')}
            locked={false}
            onNavigate={onNavigate}
            collapsed={collapsed}
          />
        )}
        {!agendaOnly && (
          <NavLink
            item={{
              href: '/dashboard/configuration',
              label: isSuperAdmin ? 'Configuración' : 'Estado',
              icon: isSuperAdmin ? Settings : ShieldCheck,
              tone: 'sky',
            }}
            active={pathname.startsWith('/dashboard/configuration')}
            locked={false}
            onNavigate={onNavigate}
            collapsed={collapsed}
          />
        )}
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new Event('futura:open-tour'));
            }
          }}
          data-sidebar-row
          aria-label="Tutorial"
          className={cn(ROW_BASE, ROW_IDLE)}
        >
          <IconChip icon={Sparkles} tone="honey" active={false} />
          <span data-sidebar-hide className="flex-1 truncate">
            Tutorial
          </span>
        </button>
      </div>
    </>
  );
}

/* La barra lateral usa un gris verdoso más frío que el lienzo para que se lea
   como una zona fija, distinta del contenido. Es un único tono de arriba abajo:
   el pie ya no lleva franja verde. */
const SIDEBAR_SURFACE =
  'bg-[linear-gradient(190deg,#f1f3f2_0%,#ecefee_50%,#e8ecea_100%)] border-r border-[#dfe4e2]';

export function DashboardSidebar({
  enabledModules,
  isSuperAdmin = false,
  branding,
  tasksBadge = 0,
  messagesBadge = 0,
  agendaOnly = false,
}: {
  enabledModules: EnabledModules;
  isSuperAdmin?: boolean;
  branding?: Branding;
  tasksBadge?: number;
  messagesBadge?: number;
  agendaOnly?: boolean;
}) {
  return (
    <aside
      data-sidebar-rail
      className={cn(
        'sticky top-0 z-30 hidden h-screen w-[268px] shrink-0 flex-col lg:flex',
        SIDEBAR_SURFACE,
      )}
    >
      <SidebarNav
        enabledModules={enabledModules}
        isSuperAdmin={isSuperAdmin}
        branding={branding}
        tasksBadge={tasksBadge}
        messagesBadge={messagesBadge}
        agendaOnly={agendaOnly}
        groupMode="flyout"
        collapsible
        anchorTour
      />
    </aside>
  );
}

export function DashboardSidebarMobile({
  open,
  onClose,
  enabledModules,
  isSuperAdmin = false,
  branding,
  tasksBadge = 0,
  messagesBadge = 0,
  agendaOnly = false,
}: {
  open: boolean;
  onClose: () => void;
  enabledModules: EnabledModules;
  isSuperAdmin?: boolean;
  branding?: Branding;
  tasksBadge?: number;
  messagesBadge?: number;
  agendaOnly?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 transition-opacity duration-300 lg:hidden',
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        aria-label="Cerrar el menú"
        className="absolute inset-0 bg-[#14211d]/40 backdrop-blur-md"
        onClick={onClose}
      />
      <aside
        className={cn(
          'absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col shadow-[0_40px_90px_-30px_rgba(20,33,29,0.6)]',
          SIDEBAR_SURFACE,
          'transition-transform duration-400 ease-[cubic-bezier(0.22,1,0.36,1)]',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <SidebarNav
          onNavigate={onClose}
          enabledModules={enabledModules}
          isSuperAdmin={isSuperAdmin}
          branding={branding}
          tasksBadge={tasksBadge}
          messagesBadge={messagesBadge}
          agendaOnly={agendaOnly}
          groupMode="inline"
        />
      </aside>
    </div>
  );
}
