'use client';

import { cn } from '@/lib/cn';
import type { ModuleKey } from '@/lib/modules';
import { useTransition, useState } from 'react';
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
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
          enabled ? 'bg-emerald-500' : 'bg-zinc-300',
          pending && 'opacity-60',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
            enabled ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  );
}
