'use client';

import { useEffect } from 'react';

const BUILT_SHA = process.env.NEXT_PUBLIC_BUILD_SHA ?? '';
const CHECK_EVERY_MS = 5 * 60_000;

/**
 * Pestañas viejas tras un despliegue. Next navega dentro del panel sin recargar
 * el CSS ni el JS, así que quien deja la pestaña abierta todo el día sigue con
 * el código de la mañana aunque se haya desplegado un arreglo. Cada 5 minutos
 * (y al volver a la pestaña) se pregunta qué versión hay desplegada; si es otra,
 * el siguiente enlace que se pulse hace una carga completa y trae la nueva.
 * No se recarga nada por sorpresa: podría haber un formulario a medias.
 */
export function VersionWatch() {
  useEffect(() => {
    if (!BUILT_SHA) return;
    let stale = false;
    let disposed = false;

    const onClick = (e: MouseEvent) => {
      if (!stale || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest('a');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith('/api/')) return;
      e.preventDefault();
      e.stopPropagation();
      window.location.assign(url.href);
    };

    const check = async () => {
      if (disposed || stale || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const { sha } = (await res.json()) as { sha: string | null };
        if (sha && sha !== BUILT_SHA) {
          stale = true;
          // Captura: antes que el <Link> de Next haga la navegación interna.
          document.addEventListener('click', onClick, true);
        }
      } catch {}
    };

    const iv = setInterval(check, CHECK_EVERY_MS);
    const onVis = () => void check();
    document.addEventListener('visibilitychange', onVis);
    void check();
    return () => {
      disposed = true;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  return null;
}
