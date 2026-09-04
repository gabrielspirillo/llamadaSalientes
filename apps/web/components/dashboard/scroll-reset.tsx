'use client';

import { usePathname } from 'next/navigation';
import { useLayoutEffect } from 'react';

/**
 * Al cambiar de sección, el panel se quedaba a la misma altura de scroll que la
 * página anterior: entrabas a Llamadas y aparecía a media página, con la
 * cabecera fuera de vista. El App Router no siempre resetea el scroll en
 * transiciones de cliente con rutas `force-dynamic`.
 *
 * Se sube al tope antes de pintar (useLayoutEffect) y otra vez en el siguiente
 * frame, para ganarle a cualquier restauración tardía del navegador cuando el
 * contenido de la página nueva termina de llegar (streaming/Suspense).
 */
export function ScrollReset() {
  const pathname = usePathname();
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname es el
  // disparador —cambia la ruta → sube al tope—, aunque el cuerpo no lo lea.
  useLayoutEffect(() => {
    const toTop = () => window.scrollTo(0, 0);
    toTop();
    const raf = requestAnimationFrame(toTop);
    return () => cancelAnimationFrame(raf);
  }, [pathname]);
  return null;
}
