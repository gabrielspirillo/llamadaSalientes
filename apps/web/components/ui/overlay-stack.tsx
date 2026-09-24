'use client';

import { useEffect, useSyncExternalStore } from 'react';

/* ============================================================================
   Registro de capas modales abiertas.

   El dock de Mensajes flota por encima de todo el panel (z-60) porque es el
   único acceso a Mensajes fuera de su pantalla. Sobre un diálogo o un panel
   lateral abierto eso deja de ser cierto: la burbuja y el anticipo del canal
   se pintan encima del detalle de la tarea y tapan el campo de comentario.

   Es un store de módulo, no un contexto: los diálogos se portalean fuera del
   árbol del panel y así el dock se entera igual, esté donde esté montado.
   ========================================================================== */

let openCount = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Declara una capa modal mientras el componente esté montado. */
export function useRegisterOverlay() {
  useEffect(() => {
    openCount += 1;
    emit();
    return () => {
      openCount -= 1;
      emit();
    };
  }, []);
}

/** `true` mientras haya al menos una capa modal abierta. */
export function useOverlayOpen() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => openCount > 0,
    () => false,
  );
}
