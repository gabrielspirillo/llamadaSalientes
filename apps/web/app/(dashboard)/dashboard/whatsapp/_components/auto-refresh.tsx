'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Refresca el server component padre llamando router.refresh() cada
 * `intervalMs`. Se usa en la lista de conversaciones de WhatsApp para que
 * los mensajes nuevos reordenen la lista y aparezca el badge de no leídos
 * sin que el operador tenga que recargar. Pausa cuando la pestaña no está
 * visible para no martillar el servidor en background.
 */
export function AutoRefresh({ intervalMs = 8000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
