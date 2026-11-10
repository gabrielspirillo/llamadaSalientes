'use client';

import { NavLink } from '@/components/dashboard/nav-progress';
import { cn } from '@/lib/cn';
import { type EnabledModules, isModuleEnabled } from '@/lib/modules';
import {
  Bot,
  CalendarDays,
  Gauge,
  Home,
  LayoutGrid,
  type LucideIcon,
  MessageCircle,
  MessageSquare,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { usePathname } from 'next/navigation';

type Tab = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Subruta que tiene su propia pestaña (Agenda no se enciende en Pacientes). */
  except?: string;
  badge?: number;
};

/**
 * Barra de pestañas del móvil, abajo y al alcance del pulgar, como en una app
 * nativa. Sólo lo del día a día; el resto sigue en el menú, que abre «Más».
 * No se pinta en escritorio (lg) ni para el profesional que sólo ve su agenda.
 */
export function MobileTabBar({
  enabledModules,
  futuraHome,
  messagesBadge = 0,
  onMore,
}: {
  enabledModules: EnabledModules;
  /** Super-admin en la organización de Futura (no gestionando una clínica). */
  futuraHome: boolean;
  messagesBadge?: number;
  onMore: () => void;
}) {
  const pathname = usePathname();

  const whatsapp = isModuleEnabled(enabledModules, 'whatsapp');
  const tabs: Tab[] = futuraHome
    ? [
        { href: '/dashboard/futura', label: 'Clínicas', icon: ShieldCheck, exact: true },
        { href: '/dashboard/futura/uso', label: 'Uso', icon: Gauge },
        { href: '/dashboard/futura/asistente', label: 'Asistente', icon: Bot },
        {
          href: '/dashboard/messages',
          label: 'Mensajes',
          icon: MessageSquare,
          badge: messagesBadge,
        },
      ]
    : [
        { href: '/dashboard', label: 'Inicio', icon: Home, exact: true },
        {
          href: '/dashboard/agenda',
          label: 'Agenda',
          icon: CalendarDays,
          except: '/dashboard/agenda/pacientes',
        },
        whatsapp
          ? { href: '/dashboard/whatsapp', label: 'WhatsApp', icon: MessageCircle }
          : {
              href: '/dashboard/messages',
              label: 'Mensajes',
              icon: MessageSquare,
              badge: messagesBadge,
            },
        { href: '/dashboard/agenda/pacientes', label: 'Pacientes', icon: Users },
      ];

  const isActive = (t: Tab) => {
    if (t.except && (pathname === t.except || pathname.startsWith(`${t.except}/`))) return false;
    return t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
  };
  const anyActive = tabs.some(isActive);
  // Con WhatsApp en la barra, los mensajes del equipo se avisan en «Más».
  const moreBadge = !futuraHome && whatsapp ? messagesBadge : 0;

  return (
    <nav
      aria-label="Navegación principal"
      data-slot="tabbar"
      className="fixed inset-x-3 bottom-[max(10px,env(safe-area-inset-bottom))] z-40 lg:hidden"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-between gap-1 rounded-[26px] border border-white/70 bg-white p-1.5 shadow-[0_18px_40px_-18px_rgba(20,60,50,0.55),inset_0_1px_0_#fff]">
        {tabs.map((t) => {
          const active = isActive(t);
          return (
            <li key={t.href} className="flex-1">
              <NavLink
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'press relative flex h-14 flex-col items-center justify-center gap-0.5 rounded-[20px] text-[11px] font-semibold transition-colors duration-200',
                  active ? 'text-white' : 'text-zinc-500 active:bg-zinc-100',
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-[20px] bg-[linear-gradient(165deg,#4ca088,#226856)] shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_8px_18px_-10px_rgba(34,104,86,0.8)]"
                  />
                )}
                <span className="relative">
                  <t.icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.3 : 2} />
                  {t.badge ? <Badge n={t.badge} /> : null}
                </span>
                <span className="relative leading-none">{t.label}</span>
              </NavLink>
            </li>
          );
        })}
        <li className="flex-1">
          <button
            type="button"
            onClick={onMore}
            aria-label="Más secciones"
            className={cn(
              'press relative flex h-14 w-full flex-col items-center justify-center gap-0.5 rounded-[20px] text-[11px] font-semibold transition-colors duration-200 active:bg-zinc-100',
              anyActive ? 'text-zinc-500' : 'text-brand-700',
            )}
          >
            <span className="relative">
              <LayoutGrid className="h-[22px] w-[22px]" />
              {moreBadge ? <Badge n={moreBadge} /> : null}
            </span>
            <span className="leading-none">Más</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

function Badge({ n }: { n: number }) {
  return (
    <span className="absolute -right-2.5 -top-1.5 min-w-[18px] rounded-full bg-rose-500 px-1 text-center text-[10px] font-bold leading-[18px] text-white ring-2 ring-white">
      {n > 99 ? '99+' : n}
    </span>
  );
}
