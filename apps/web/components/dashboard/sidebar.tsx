'use client';

import { cn } from '@/lib/cn';
import { OrganizationSwitcher } from '@clerk/nextjs';
import {
  BarChart3,
  Bot,
  Building2,
  CreditCard,
  HelpCircle,
  Home,
  PhoneCall,
  Settings,
  Stethoscope,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/dashboard', label: 'Overview', icon: Home },
  { href: '/dashboard/calls', label: 'Llamadas', icon: PhoneCall },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/dashboard/agent', label: 'Agente', icon: Bot },
  { href: '/dashboard/treatments', label: 'Tratamientos', icon: Stethoscope },
  { href: '/dashboard/faqs', label: 'FAQs', icon: HelpCircle },
  { href: '/dashboard/team', label: 'Equipo', icon: Users },
  { href: '/dashboard/settings', label: 'Clínica', icon: Building2 },
  { href: '/dashboard/billing', label: 'Facturación', icon: CreditCard },
] as const;

export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-zinc-200/70 bg-zinc-50/40">
      <div className="flex h-14 items-center gap-2 border-b border-zinc-200/70 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-black">
          <span className="text-xs font-semibold text-white">D</span>
        </div>
        <span className="text-[15px] font-semibold tracking-tight">DentalVoice</span>
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
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-white/60 hover:text-zinc-900 transition-colors"
        >
          <Settings className="h-4 w-4" />
          Configuración
        </Link>
      </div>
    </aside>
  );
}
