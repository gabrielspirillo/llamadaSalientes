'use client';

import { cn } from '@/lib/cn';
import Link from 'next/link';
import { FlaskConical, MessageCircle, Phone, Plug, ToggleRight } from 'lucide-react';

export type ConfigTab = 'whatsapp' | 'telephony' | 'integrations' | 'modules' | 'playground';

const BASE_TABS: { key: ConfigTab; label: string; icon: typeof MessageCircle }[] = [
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { key: 'playground', label: 'Probador', icon: FlaskConical },
  { key: 'telephony', label: 'Telefonía', icon: Phone },
  { key: 'integrations', label: 'Integraciones', icon: Plug },
];

const MODULES_TAB: { key: ConfigTab; label: string; icon: typeof MessageCircle } = {
  key: 'modules',
  label: 'Módulos',
  icon: ToggleRight,
};

export function ConfigurationTabs({
  active,
  showModulesTab,
}: {
  active: ConfigTab;
  showModulesTab: boolean;
}) {
  const TABS = showModulesTab ? [...BASE_TABS, MODULES_TAB] : BASE_TABS;
  return (
    <div className="mb-6">
      <nav className="scrollbar-none inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-[--color-border] bg-white/70 p-1 backdrop-blur-xl">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.key === active;
          return (
            <Link
              key={t.key}
              href={`/dashboard/configuration?tab=${t.key}`}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold transition-all duration-300',
                isActive
                  ? 'bg-[linear-gradient(120deg,#7139e8,#8b5cf6)] text-white shadow-[0_6px_18px_-8px_rgba(113,57,232,0.8)]'
                  : 'text-zinc-500 hover:bg-brand-50 hover:text-brand-700',
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
