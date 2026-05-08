'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type Props = {
  intervalMs?: number;
};

/**
 * Refresca server components cada `intervalMs` ms via router.refresh().
 * Solo refresca cuando la pestaña está visible para no quemar requests.
 */
export function RealtimeRefresh({ intervalMs = 30_000 }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (document.visibilityState === 'visible') {
        router.refresh();
      }
    };

    const iv = setInterval(tick, intervalMs);
    const onVis = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [router, intervalMs, enabled]);

  return (
    <button
      type="button"
      onClick={() => setEnabled((v) => !v)}
      className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 transition-colors"
      title={enabled ? 'Pausar auto-refresh' : 'Reanudar auto-refresh'}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          enabled ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'
        }`}
      />
      {enabled ? 'En vivo · cada 30s' : 'Pausado'}
    </button>
  );
}
