'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

const BEAT_MS = 60_000;
/** Sin tocar nada en 3 minutos, la persona no está usando el panel. */
const IDLE_MS = 3 * 60_000;

/**
 * Mide el tiempo de uso real: un latido por minuto sólo si la pestaña está
 * visible y hubo actividad (ratón, teclado, toque, scroll) en los últimos 3
 * minutos. Una pestaña olvidada abierta no suma. Sin UI.
 */
export function UsageBeacon() {
  const pathname = usePathname();
  const pathRef = React.useRef(pathname);
  pathRef.current = pathname;

  React.useEffect(() => {
    let lastActivity = Date.now();
    const mark = () => {
      lastActivity = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'mousemove', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, mark, { passive: true });

    const beat = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastActivity > IDLE_MS) return;
      fetch('/api/usage/beat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathRef.current }),
        keepalive: true,
      }).catch(() => undefined);
    };
    // El primer minuto se cuenta al poco de entrar, no al minuto.
    const first = window.setTimeout(beat, 15_000);
    const iv = window.setInterval(beat, BEAT_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(iv);
      for (const e of events) window.removeEventListener(e, mark);
    };
  }, []);

  return null;
}
