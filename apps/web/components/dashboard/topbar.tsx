'use client';

import { UserButton } from '@clerk/nextjs';
import { Bell, Search } from 'lucide-react';

export function DashboardTopbar() {
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-zinc-200/70 bg-white/70 backdrop-blur-xl px-6">
      <div className="flex items-center gap-3">
        <div className="hidden md:flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 text-sm text-zinc-500 w-72">
          <Search className="h-3.5 w-3.5" />
          Buscar llamadas, pacientes…
          <kbd className="ml-auto text-xs text-zinc-400">⌘K</kbd>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="relative h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-zinc-100 transition-colors"
        >
          <Bell className="h-4 w-4 text-zinc-600" />
          <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-red-500" />
        </button>
        <UserButton
          appearance={{
            elements: {
              avatarBox: 'h-8 w-8 ring-2 ring-white',
            },
          }}
        />
      </div>
    </header>
  );
}
