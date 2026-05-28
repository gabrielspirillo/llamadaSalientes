'use client';

import { cn } from '@/lib/cn';
import Link from 'next/link';
import { MessageCircle, Phone, Plug } from 'lucide-react';

export type ConfigTab = 'whatsapp' | 'telephony' | 'integrations';

const TABS: { key: ConfigTab; label: string; icon: typeof MessageCircle }[] = [
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { key: 'telephony', label: 'Telefonía', icon: Phone },
  { key: 'integrations', label: 'Integraciones', icon: Plug },
];

export function ConfigurationTabs({ active }: { active: ConfigTab }) {
  return (
    <div className="mb-6 border-b border-zinc-200">
      <nav className="-mb-px flex flex-wrap gap-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.key === active;
          return (
            <Link
              key={t.key}
              href={`/dashboard/configuration?tab=${t.key}`}
              className={cn(
                'inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'border-zinc-900 text-zinc-900'
                  : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800',
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
