'use client';

import { useMessaging } from '@/components/messaging/MessagingProvider';
import { cn } from '@/lib/cn';
import { type EnabledModules, isModuleEnabled, moduleForRoute } from '@/lib/modules';
import { OrganizationSwitcher } from '@clerk/nextjs';
import {
  BarChart3,
  BellRing,
  Bot,
  Building2,
  ClipboardCheck,
  Contact,
  HelpCircle,
  Home,
  LayoutDashboard,
  ListChecks,
  Lock,
  MessageCircle,
  MessageSquare,
  PhoneCall,
  PhoneOutgoing,
  Settings,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

type NavItem = {
  href: string;
  label: string;
  icon: typeof Home;
  /** Color del chip del icono cuando el ítem está activo. */
  tone: 'brand' | 'blossom' | 'mint' | 'sky' | 'honey' | 'coral';
};

type NavGroup = { title: string | null; items: readonly NavItem[] };

const GROUPS: readonly NavGroup[] = [
  {
    title: null,
    items: [
      { href: '/dashboard', label: 'Panel', icon: Home, tone: 'brand' },
      { href: '/dashboard/messages', label: 'Mensajes', icon: MessageSquare, tone: 'brand' },
      { href: '/dashboard/tasks', label: 'Tareas', icon: ClipboardCheck, tone: 'blossom' },
      { href: '/dashboard/analytics', label: 'Métricas', icon: BarChart3, tone: 'sky' },
    ],
  },
  {
    title: 'Canales',
    items: [
      { href: '/dashboard/calls', label: 'Llamadas', icon: PhoneCall, tone: 'brand' },
      {
        href: '/dashboard/outbound',
        label: 'Llamadas salientes',
        icon: PhoneOutgoing,
        tone: 'blossom',
      },
      { href: '/dashboard/whatsapp', label: 'WhatsApp', icon: MessageCircle, tone: 'mint' },
      { href: '/dashboard/reminders', label: 'Recordatorios', icon: BellRing, tone: 'honey' },
      { href: '/dashboard/waitlist', label: 'Lista de espera', icon: ListChecks, tone: 'coral' },
    ],
  },
  {
    title: 'Registros',
    items: [
      { href: '/dashboard/contacts', label: 'Pacientes', icon: Contact, tone: 'sky' },
      { href: '/dashboard/treatments', label: 'Tratamientos', icon: Stethoscope, tone: 'mint' },
      { href: '/dashboard/faqs', label: 'Preguntas frecuentes', icon: HelpCircle, tone: 'honey' },
      { href: '/dashboard/team', label: 'Equipo', icon: Users, tone: 'blossom' },
    ],
  },
  {
    title: 'Clínica',
    items: [
      { href: '/dashboard/agent', label: 'Asistente', icon: Bot, tone: 'brand' },
      { href: '/dashboard/settings', label: 'Datos de la clínica', icon: Building2, tone: 'sky' },
    ],
  },
] as const;

const ICON_TONE: Record<NavItem['tone'], string> = {
  brand: 'bg-brand-100 text-brand-700',
  blossom: 'bg-emerald-100 text-emerald-600',
  mint: 'bg-emerald-100 text-emerald-600',
  sky: 'bg-sky-100 text-sky-600',
  honey: 'bg-amber-100 text-amber-600',
  coral: 'bg-rose-100 text-rose-600',
};

function isActive(pathname: string, href: string) {
  return href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);
}

/** Marca de FUTURA: nombre + punto verde, como siempre. */
function BrandMark() {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-[21px] font-extrabold leading-none tracking-tight text-[#0f1f2e]">
        FUTURA
      </span>
      <span className="inline-block h-2 w-2 rounded-full bg-[#5fa896]" />
    </span>
  );
}

function NavLink({
  item,
  active,
  locked,
  onNavigate,
  tourAnchor,
  badge = 0,
  badgeLabel,
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
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      data-tour={tourAnchor}
      onClick={onNavigate}
      className={cn(
        'group relative flex items-center gap-3 rounded-2xl px-2.5 py-2 text-[14px] font-medium',
        'transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        active
          ? 'bg-white text-zinc-900 shadow-[0_8px_20px_-12px_rgba(20,33,29,0.45)]'
          : 'text-zinc-600 hover:translate-x-0.5 hover:bg-white/70 hover:text-zinc-900',
      )}
    >
      {/* Barra de acento a la izquierda del activo */}
      <span
        aria-hidden
        className={cn(
          'absolute -left-2 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-[linear-gradient(180deg,#37766a,#6bc2a4)] transition-all duration-300',
          active ? 'opacity-100' : 'scale-y-0 opacity-0',
        )}
      />
      <span
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-300',
          active
            ? ICON_TONE[item.tone]
            : 'bg-white/70 text-zinc-500 group-hover:bg-white group-hover:text-zinc-700',
          'group-hover:scale-110',
        )}
      >
        <Icon className="h-[17px] w-[17px]" />
      </span>
      <span className="flex-1 truncate">{item.label}</span>
      {badge > 0 && (
        <span
          className="inline-flex min-w-[20px] shrink-0 items-center justify-center rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white"
          aria-label={badgeLabel ?? `${badge} pendientes en ${item.label}`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {locked && (
        <Lock className="h-3 w-3 shrink-0 text-zinc-400" aria-label="Módulo no contratado" />
      )}
    </Link>
  );
}

function SidebarNav({
  onNavigate,
  enabledModules,
  isSuperAdmin = false,
  anchorTour = false,
  tasksBadge = 0,
  messagesBadge = 0,
}: {
  onNavigate?: () => void;
  enabledModules: EnabledModules;
  isSuperAdmin?: boolean;
  anchorTour?: boolean;
  /** Tareas mías vencidas o para hoy. 0 = no se muestra nada. */
  tasksBadge?: number;
  /** Mensajes sin leer. Hidrata del server y a partir de ahí manda el stream. */
  messagesBadge?: number;
}) {
  const pathname = usePathname();
  // El contador del server hidrata; después manda el stream del provider.
  const messaging = useMessaging();
  const liveMessages = messaging.ready ? messaging.totalUnread : messagesBadge;

  return (
    <>
      {/* --- Marca ---------------------------------------------------------- */}
      <div className="flex h-[68px] items-center justify-between gap-2 px-5">
        <Link href="/dashboard" onClick={onNavigate} aria-label="FUTURA">
          <BrandMark />
        </Link>
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
      <div className="px-3 pb-1 pt-1">
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
      <nav className="scrollbar-none flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {GROUPS.map((group) => (
          <div key={group.title ?? 'top'}>
            {group.title && (
              <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                {group.title}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((it) => {
                const moduleKey = moduleForRoute(it.href);
                const locked = moduleKey !== null && !isModuleEnabled(enabledModules, moduleKey);
                return (
                  <NavLink
                    key={it.href}
                    item={it}
                    active={isActive(pathname, it.href)}
                    locked={locked}
                    onNavigate={onNavigate}
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
            </div>
          </div>
        ))}
      </nav>

      {/* --- Pie ------------------------------------------------------------ */}
      <div className="space-y-0.5 px-3 pb-4">
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
          />
        )}
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
        />
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new Event('futura:open-tour'));
            }
          }}
          className="group flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-[14px] font-medium text-zinc-600 transition-all duration-300 hover:bg-white/70 hover:text-zinc-900"
        >
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/70 text-brand-600 transition-transform duration-300 group-hover:scale-110 group-hover:bg-white">
            <Sparkles className="h-[17px] w-[17px]" />
          </span>
          <span className="flex-1 text-left">Tutorial</span>
        </button>
      </div>
    </>
  );
}

/* La barra lateral usa un verde más saturado que el lienzo para que se lea
   como una zona fija, distinta del contenido. */
const SIDEBAR_SURFACE =
  'bg-[linear-gradient(190deg,#f1f3f2_0%,#ecefee_50%,#e8ecea_100%)] border-r border-[#dfe4e2]';

export function DashboardSidebar({
  enabledModules,
  isSuperAdmin = false,
  tasksBadge = 0,
  messagesBadge = 0,
}: {
  enabledModules: EnabledModules;
  isSuperAdmin?: boolean;
  tasksBadge?: number;
  messagesBadge?: number;
}) {
  return (
    <aside
      className={cn(
        'sticky top-0 z-30 hidden h-screen w-[268px] shrink-0 flex-col lg:flex',
        SIDEBAR_SURFACE,
      )}
    >
      <SidebarNav
        enabledModules={enabledModules}
        isSuperAdmin={isSuperAdmin}
        tasksBadge={tasksBadge}
        messagesBadge={messagesBadge}
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
  tasksBadge = 0,
  messagesBadge = 0,
}: {
  open: boolean;
  onClose: () => void;
  enabledModules: EnabledModules;
  isSuperAdmin?: boolean;
  tasksBadge?: number;
  messagesBadge?: number;
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
          tasksBadge={tasksBadge}
          messagesBadge={messagesBadge}
        />
      </aside>
    </div>
  );
}
