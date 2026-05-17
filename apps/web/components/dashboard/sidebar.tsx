'use client';

import { cn } from '@/lib/cn';
import { OrganizationSwitcher } from '@clerk/nextjs';
import {
  BarChart3,
  Bot,
  Building2,
  Contact,
  HelpCircle,
  Home,
  MessageCircle,
  Phone,
  PhoneCall,
  PhoneOutgoing,
  Settings,
  Stethoscope,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

const items = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  { href: '/dashboard/calls', label: 'Llamadas', icon: PhoneCall },
  { href: '/dashboard/outbound', label: 'Salientes', icon: PhoneOutgoing },
  { href: '/dashboard/whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { href: '/dashboard/contacts', label: 'Contactos', icon: Contact },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/dashboard/agent', label: 'Agente', icon: Bot },
  { href: '/dashboard/treatments', label: 'Tratamientos', icon: Stethoscope },
  { href: '/dashboard/faqs', label: 'FAQs', icon: HelpCircle },
  { href: '/dashboard/team', label: 'Equipo', icon: Users },
  { href: '/dashboard/settings', label: 'Clínica', icon: Building2 },
  { href: '/dashboard/settings/telephony', label: 'Telefonía', icon: Phone },
] as const;

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <>
      <div className="flex h-14 items-center justify-between border-b border-zinc-200/70 px-5">
        <div className="flex items-center gap-1.5">
          <span className="text-[18px] font-extrabold tracking-tight text-[#0f1f2e] leading-none">
            FUTURA
          </span>
          <span className="inline-block h-2 w-2 rounded-full bg-[#5fa896]" />
        </div>
        {onNavigate && (
          <button
            type="button"
            onClick={onNavigate}
            aria-label="Cerrar menú"
            className="lg:hidden inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="px-3 pt-3">
        <OrganizationSwitcher
          hidePersonal
          afterCreateOrganizationUrl="/dashboard"
          afterSelectOrganizationUrl="/dashboard"
          appearance={{
            elements: {
              rootBox: 'w-full',
              organizationSwitcherTrigger:
                'w-full justify-between rounded-xl border border-zinc-200/70 bg-white px-3 py-2 text-sm hover:border-zinc-300 transition-colors',
            },
          }}
        />
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {items.map((it) => {
          const Icon = it.icon;
          const active =
            it.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-white text-zinc-900 shadow-sm border border-zinc-200/70 font-medium'
                  : 'text-zinc-600 hover:text-zinc-900 hover:bg-white/60',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{it.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-4">
        <Link
          href="/dashboard/settings"
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-white/60 hover:text-zinc-900 transition-colors"
        >
          <Settings className="h-4 w-4" />
          Configuración
        </Link>
      </div>
    </>
  );
}

export function DashboardSidebar() {
  return (
    <aside className="hidden lg:flex sticky top-0 h-screen w-60 shrink-0 flex-col border-r border-zinc-200/70 bg-zinc-50/40">
      <SidebarNav />
    </aside>
  );
}

export function DashboardSidebarMobile({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
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
        'lg:hidden fixed inset-0 z-50 transition-opacity',
        open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
      )}
      aria-hidden={!open}
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside
        className={cn(
          'absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-zinc-200/70 bg-zinc-50 shadow-2xl transition-transform',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <SidebarNav onNavigate={onClose} />
      </aside>
    </div>
  );
}
