'use client';

import NextLink from 'next/link';
import { useLinkStatus } from 'next/link';
import type { ComponentProps } from 'react';
import { useEffect, useSyncExternalStore } from 'react';

/**
 * Feedback inmediato al cambiar de sección.
 *
 * El panel es todo `force-dynamic`: entre el clic y el primer byte del servidor
 * pasan cientos de milisegundos en los que la pantalla se quedaba EXACTAMENTE
 * igual —mismo contenido, mismo ítem del menú marcado—, así que la sensación
 * era que la app se había colgado y la gente volvía a hacer clic, encolando una
 * segunda navegación. `loading.tsx` no lo tapa: sólo aparece cuando el router
 * ya empezó a pintar la ruta nueva.
 *
 * `useLinkStatus` (Next 15.3+) da el estado pendiente del <Link> concreto que
 * se pulsó, pero sólo se puede leer DENTRO de ese Link. Por eso hay dos piezas:
 * la baliza que va dentro del enlace y publica su estado en un store mínimo, y
 * la barra superior que lo consume. Así el ítem pulsado se marca al instante y
 * además hay una señal global en lo alto de la pantalla.
 */

let pendingCount = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
  return pendingCount > 0;
}

/** En el servidor nunca hay navegación pendiente. */
function getServerSnapshot() {
  return false;
}

/**
 * Baliza: se monta DENTRO de un <Link> y publica si esa navegación está en
 * curso. No pinta nada por sí misma.
 */
function NavPendingBeacon() {
  const { pending } = useLinkStatus();

  useEffect(() => {
    if (!pending) return;
    pendingCount += 1;
    emit();
    return () => {
      pendingCount -= 1;
      emit();
    };
  }, [pending]);

  return null;
}

/**
 * `<Link>` del panel. Idéntico al de Next salvo que avisa de su propia
 * navegación pendiente. Acepta `data-nav-pending` en el elemento para que el
 * CSS del ítem reaccione sin más JS.
 */
export function NavLink({ children, ...props }: ComponentProps<typeof NextLink>) {
  return (
    <NextLink {...props}>
      {children}
      <NavPendingBeacon />
    </NextLink>
  );
}

/**
 * Barra de progreso indeterminada, fija arriba del todo. Se monta una vez en el
 * layout del panel.
 *
 * No intenta estimar el porcentaje: no hay forma de saberlo y una barra que
 * miente se nota. Es una barra que recorre la pantalla mientras haya algo
 * pendiente y desaparece al llegar el contenido.
 */
export function NavProgressBar() {
  const active = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <div
      aria-hidden={!active}
      className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-[3px]"
      style={{ opacity: active ? 1 : 0, transition: 'opacity 180ms ease' }}
    >
      {active && <div className="nav-progress-bar h-full" />}
    </div>
  );
}

/**
 * Indicador en línea para un ítem de menú o una pestaña: un punto que late
 * mientras esa navegación concreta está en curso. Va dentro del <Link>.
 */
export function NavPendingDot({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className={`ml-1 inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current ${className ?? ''}`}
    />
  );
}
