'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Mantiene la lista de conversaciones de WhatsApp al día.
 *
 * En tiempo real: se suscribe al SSE del buzón (`/api/whatsapp/inbox/stream`) y
 * refresca el server component padre en cuanto entra o sale un mensaje, así el
 * operador ve la conversación nueva y el badge de no leídos al instante. El
 * refresh se agrupa (debounce) para no dispararlo N veces en una ráfaga.
 *
 * Respaldo: un poll lento por si el SSE se cae (Redis, proxy) o el navegador no
 * lo soporta. Antes esto era la única vía y corría cada 8s; ahora es sólo la red
 * de seguridad. Ambos se pausan cuando la pestaña no está visible.
 */
export function AutoRefresh({ fallbackMs = 25000 }: { fallbackMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const refreshSoon = () => {
      if (document.visibilityState !== 'visible') return;
      if (debounce) return;
      debounce = setTimeout(() => {
        debounce = null;
        router.refresh();
      }, 400);
    };

    // Tiempo real. EventSource reintenta solo si se corta.
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/whatsapp/inbox/stream');
      es.addEventListener('inbox', refreshSoon);
    } catch {
      // Sin EventSource: queda el poll de respaldo.
    }

    // Respaldo lento.
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, fallbackMs);

    return () => {
      if (debounce) clearTimeout(debounce);
      clearInterval(poll);
      es?.close();
    };
  }, [router, fallbackMs]);

  return null;
}
