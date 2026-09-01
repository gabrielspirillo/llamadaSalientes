'use client';

import { StatusDot } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { type EnabledModules, isModuleEnabled, moduleForRoute } from '@/lib/modules';
import { OrganizationSwitcher } from '@clerk/nextjs';
import {
  BarChart3,
  BellRing,
  ClipboardCheck,
  Bot,
  Building2,
  Contact,
  HelpCircle,
  Home,
  LayoutDashboard,
  ListChecks,
  Lock,
  MessageCircle,
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
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

type NavItem = {
  href: string;
  label: string;
  icon: typeof Home;
  /** Color del chip del icono cuando el ítem está activo. */
  tone: 'grape' | 'blossom' | 'mint' | 'sky' | 'honey' | 'coral';
};

type NavGroup = { title: string | null; items: readonly NavItem[] };

const GROUPS: readonly NavGroup[] = [
  {
    title: null,
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: Home, tone: 'grape' },
      { href: '/dashboard/tasks', label: 'Tareas', icon: ClipboardCheck, tone: 'blossom' },
      { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3, tone: 'sky' },
    ],
  },
  {
    title: 'Canales',
    items: [
      { href: '/dashboard/calls', label: 'Llamadas', icon: PhoneCall, tone: 'grape' },
      { href: '/dashboard/outbound', label: 'Salientes', icon: PhoneOutgoing, tone: 'blossom' },
      { href: '/dashboard/whatsapp', label: 'WhatsApp', icon: MessageCircle, tone: 'mint' },
      { href: '/dashboard/reminders', label: 'Recordatorios', icon: BellRing, tone: 'honey' },
      { href: '/dashboard/waitlist', label: 'Waitlist', icon: ListChecks, tone: 'coral' },
    ],
  },
  {
    title: 'Registros',
    items: [
      { href: '/dashboard/contacts', label: 'Contactos', icon: Contact, tone: 'sky' },
      { href: '/dashboard/treatments', label: 'Tratamientos', icon: Stethoscope, tone: 'mint' },
      { href: '/dashboard/faqs', label: 'FAQs', icon: HelpCircle, tone: 'honey' },
      { href: '/dashboard/team', label: 'Equipo', icon: Users, tone: 'blossom' },
    ],
  },
  {
    title: 'Clínica',
    items: [
      { href: '/dashboard/agent', label: 'Agente', icon: Bot, tone: 'grape' },
      { href: '/dashboard/settings', label: 'Datos de la clínica', icon: Building2, tone: 'sky' },
    ],
  },
] as const;

const ICON_TONE: Record<NavItem['tone'], string> = {
  grape: 'bg-violet-100 text-violet-600',
  blossom: 'bg-pink-100 text-pink-600',
  mint: 'bg-emerald-100 text-emerald-600',
  sky: 'bg-sky-100 text-sky-600',
  honey: 'bg-amber-100 text-amber-600',
  coral: 'bg-rose-100 text-rose-600',
};

const COLLAPSE_KEY = 'futura.sidebar.collapsed';

function isActive(pathname: string, href: string) {
  return href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);
}

function NavLink({
  item,
  active,
  locked,
  collapsed,
  onNavigate,
  tourAnchor,
  index,
  badge = 0,
}: {
  item: { href: string; label: string; icon: typeof Home; tone: NavItem['tone'] };
  active: boolean;
  locked: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
  tourAnchor?: string;
  index: number;
  /** Contador que se dibuja a la derecha (0 = nada). */
  badge?: number;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      data-tour={tourAnchor}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      style={{ ['--i' as string]: index }}
      className={cn(
        'group relative flex items-center gap-3 rounded-2xl px-2.5 py-2 text-[13.5px] font-medium',
        'transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        active
          ? 'bg-white text-zinc-900 shadow-[0_8px_20px_-12px_rgba(23,20,41,0.4)]'
          : 'text-zinc-600 hover:bg-white/70 hover:text-zinc-900 hover:translate-x-0.5',
        collapsed && 'justify-center px-0',
      )}
    >
      {/* Barra de acento a la izquierda del activo */}
      <span
        aria-hidden
        className={cn(
          'absolute -left-2 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-[linear-gradient(180deg,#7139e8,#ec4899)] transition-all duration-300',
          active ? 'opacity-100' : 'scale-y-0 opacity-0',
        )}
      />
      <span
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-300',
          active
            ? ICON_TONE[item.tone]
            : 'bg-white/60 text-zinc-500 group-hover:bg-white group-hover:text-zinc-700',
          'group-hover:scale-110',
        )}
      >
        <Icon className="h-[17px] w-[17px]" />
        {/* Colapsada no hay lugar para el número: un punto avisa igual. */}
        {collapsed && badge > 0 && (
          <span
            aria-hidden
            className="absolute right-1 top-1 h-2 w-2 rounded-full bg-violet-600 ring-2 ring-white"
          />
        )}
      </span>
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {!collapsed && badge > 0 && (
        <span
          className="inline-flex min-w-[20px] shrink-0 items-center justify-center rounded-full bg-violet-600 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white"
          aria-label={`${badge} tareas para hoy o vencidas`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {!collapsed && locked && (
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
  collapsed = false,
  onToggleCollapse,
  tasksBadge = 0,
}: {
  onNavigate?: () => void;
  enabledModules: EnabledModules;
  isSuperAdmin?: boolean;
  anchorTour?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Tareas mías vencidas o para hoy. 0 = no se muestra nada. */
  tasksBadge?: number;
}) {
  const pathname = usePathname();
  let index = 0;

  return (
    <>
      {/* --- Marca ---------------------------------------------------------- */}
      <div
        className={cn(
          'flex h-[68px] items-center justify-between gap-2 px-4',
          collapsed && 'justify-center px-0',
        )}
      >
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="group flex min-w-0 items-center gap-2.5"
          aria-label="FUTURA"
        >
          <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[13px] bg-[linear-gradient(135deg,#7139e8,#a855f7_60%,#ec4899)] text-white shadow-[0_8px_20px_-8px_rgba(113,57,232,0.9)] transition-transform duration-500 group-hover:rotate-6 group-hover:scale-105">
            <Sparkles className="h-4 w-4" />
            <span className="absolute inset-0 rounded-[13px] ring-1 ring-inset ring-white/30" />
          </span>
          {!collapsed && (
            <span className="min-w-0 leading-none">
              <span className="block truncate text-[17px] font-extrabold tracking-tight text-zinc-900">
                FUTURA
              </span>
              <span className="mt-0.5 block truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Solutions
              </span>
            </span>
          )}
        </Link>

        {onNavigate ? (
          <button
            type="button"
            onClick={onNavigate}
            aria-label="Cerrar menú"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-zinc-500 transition-all hover:rotate-90 hover:bg-white hover:text-zinc-900 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-xl text-zinc-400 transition-all duration-300 hover:bg-white hover:text-zinc-800',
                collapsed && 'absolute right-2 top-[72px]',
              )}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          )
        )}
      </div>

      {/* --- Selector de organización -------------------------------------- */}
      {!collapsed && (
        <div className="px-3 pb-1 pt-1">
          <OrganizationSwitcher
            hidePersonal
            afterCreateOrganizationUrl="/dashboard"
            afterSelectOrganizationUrl="/dashboard"
            appearance={{
              elements: {
                rootBox: 'w-full',
                organizationSwitcherTrigger:
                  'w-full justify-between rounded-2xl border border-white/70 bg-white/70 px-3 py-2.5 text-sm backdrop-blur-xl transition-all hover:bg-white hover:shadow-[0_8px_20px_-14px_rgba(23,20,41,0.5)]',
              },
            }}
          />
        </div>
      )}

      {/* --- Navegación ----------------------------------------------------- */}
      <nav className="scrollbar-none flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {GROUPS.map((group) => (
          <div key={group.title ?? 'top'}>
            {group.title && !collapsed && (
              <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                {group.title}
              </p>
            )}
            {group.title && collapsed && (
              <div className="mx-auto mb-2 h-px w-6 bg-zinc-300/70" aria-hidden />
            )}
            <div className="space-y-0.5">
              {group.items.map((it) => {
                const moduleKey = moduleForRoute(it.href);
                const locked = moduleKey !== null && !isModuleEnabled(enabledModules, moduleKey);
                return (
                  <NavLink
                    key={it.href}
                    item={it}
                    index={index++}
                    active={isActive(pathname, it.href)}
                    locked={locked}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                    tourAnchor={anchorTour ? it.href : undefined}
                    badge={it.href === '/dashboard/tasks' ? tasksBadge : 0}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* --- Pie ------------------------------------------------------------ */}
      <div className="space-y-0.5 px-3 pb-3">
        {isSuperAdmin && (
          <NavLink
            item={{
              href: '/dashboard/futura',
              label: 'Panel Futura',
              icon: LayoutDashboard,
              tone: 'grape',
            }}
            index={index++}
            active={pathname.startsWith('/dashboard/futura')}
            locked={false}
            collapsed={collapsed}
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
          index={index++}
          active={pathname.startsWith('/dashboard/configuration')}
          locked={false}
          collapsed={collapsed}
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
          title={collapsed ? 'Tutorial' : undefined}
          className={cn(
            'group flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-[13.5px] font-medium text-zinc-600 transition-all duration-300 hover:bg-white/70 hover:text-zinc-900',
            collapsed && 'justify-center px-0',
          )}
        >
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/60 text-violet-500 transition-transform duration-300 group-hover:scale-110 group-hover:bg-white">
            <Sparkles className="h-[17px] w-[17px]" />
          </span>
          {!collapsed && <span className="flex-1 text-left">Tutorial</span>}
        </button>

        {/* Estado del sistema — cierra la barra con un guiño "en vivo" */}
        {!collapsed && (
          <div className="mt-3 flex items-center gap-2 rounded-2xl bg-white/60 px-3 py-2.5 backdrop-blur-xl">
            <StatusDot tone="success" />
            <span className="text-[11px] font-medium text-zinc-500">Agente operativo</span>
          </div>
        )}
      </div>
    </>
  );
}

export function DashboardSidebar({
  enabledModules,
  isSuperAdmin = false,
  tasksBadge = 0,
}: {
  enabledModules: EnabledModules;
  isSuperAdmin?: boolean;
  tasksBadge?: number;
}) {
  const [collapsed, setCollapsed] = useState(false);

  // Preferencia persistida — se lee después del montaje para no romper SSR.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
  }, []);

  function toggle() {
    setCollapsed((v) => {
      const next = !v;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      }
      return next;
    });
  }

  return (
    <aside
      className={cn(
        'sticky top-0 z-30 hidden h-screen shrink-0 flex-col lg:flex',
        'border-r border-white/60',
        'bg-[linear-gradient(185deg,#ffffff_0%,#f6f2ff_38%,#f4edfb_66%,#fbeef6_100%)]',
        'transition-[width] duration-400 ease-[cubic-bezier(0.22,1,0.36,1)]',
        collapsed ? 'w-[88px]' : 'w-[268px]',
      )}
    >
      <SidebarNav
        enabledModules={enabledModules}
        isSuperAdmin={isSuperAdmin}
        tasksBadge={tasksBadge}
        anchorTour
        collapsed={collapsed}
        onToggleCollapse={toggle}
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
}: {
  open: boolean;
  onClose: () => void;
  enabledModules: EnabledModules;
  isSuperAdmin?: boolean;
  tasksBadge?: number;
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
      <div className="absolute inset-0 bg-[#171429]/40 backdrop-blur-md" onClick={onClose} />
      <aside
        className={cn(
          'absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col shadow-[0_40px_90px_-30px_rgba(23,20,41,0.6)]',
          'bg-[linear-gradient(185deg,#ffffff_0%,#f6f2ff_38%,#f4edfb_66%,#fbeef6_100%)]',
          'transition-transform duration-400 ease-[cubic-bezier(0.22,1,0.36,1)]',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <SidebarNav
          onNavigate={onClose}
          enabledModules={enabledModules}
          isSuperAdmin={isSuperAdmin}
          tasksBadge={tasksBadge}
        />
      </aside>
    </div>
  );
}
