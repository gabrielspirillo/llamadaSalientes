'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Al cambiar de sección, el panel se quedaba a la misma altura de scroll que la
 * página anterior: entrabas a Llamadas y aparecía a media página, con la
 * cabecera fuera de vista. El App Router no siempre resetea el scroll en
 * transiciones de cliente con rutas `force-dynamic`, así que lo hacemos a mano.
 *
 * Se sube al tope en cuanto cambia la ruta. `instant` para que no se vea el
 * viaje; si el usuario prefiere menos movimiento, igual es instantáneo.
 */
export function ScrollReset() {
  const pathname = usePathname();
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname es justo
  // el disparador —cambia de ruta → sube al tope—, aunque el cuerpo no lo lea.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}
