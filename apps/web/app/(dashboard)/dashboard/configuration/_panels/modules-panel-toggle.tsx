'use client';

import { cn } from '@/lib/cn';
import type { ModuleKey } from '@/lib/modules';
import { useState, useTransition } from 'react';
import { toggleModuleAction } from './modules-panel-actions';

export function ModuleToggle({
  tenantId,
  moduleKey,
  initialEnabled,
}: {
  tenantId: string;
  moduleKey: ModuleKey;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    const next = !enabled;
    const prev = enabled;
    setError(null);
    setEnabled(next); // optimistic
    startTransition(async () => {
      const result = await toggleModuleAction(tenantId, moduleKey, next);
      if (!result.ok) {
        setEnabled(prev); // rollback
        setError(result.error);
      }
    });
  }

  return (
    <div className="inline-flex flex-col items-center gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={pending}
        onClick={handleToggle}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-300',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/20',
          enabled
            ? 'bg-[linear-gradient(120deg,#059669,#10b981)] shadow-[0_4px_12px_-4px_rgba(16,185,129,0.7)]'
            : 'bg-zinc-200',
          pending && 'opacity-60',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
            enabled ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
      {error && <span className="text-[12px] text-rose-600">{error}</span>}
    </div>
  );
}
