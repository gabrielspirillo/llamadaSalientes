'use client';

import { cn } from '@/lib/cn';
import { Info, X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

// El botón vive en la cabecera (servidor) y el panel al lado del chat: se
// hablan por un evento de ventana en vez de subir el estado a un cliente que
// envolviera la página entera.
const OPEN_EVENT = 'wa:chat-info';

/** Botón «i» de la cabecera del chat. Sólo en móvil. */
export function ChatInfoButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      aria-label="Datos del contacto"
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-600 transition-colors hover:bg-zinc-100 active:bg-zinc-200 lg:hidden"
    >
      <Info className="h-5 w-5" />
    </button>
  );
}

/**
 * La columna de la derecha (contacto, IA, etiquetas, citas). En escritorio se
 * queda donde siempre; en móvil se esconde y se abre a pantalla completa con
 * el botón «i», para que el chat tenga toda la pantalla.
 */
export function ChatInfoPanel({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div
      className={cn(
        'lg:flex lg:min-h-0',
        open
          ? 'max-lg:fixed max-lg:inset-0 max-lg:z-[60] max-lg:flex max-lg:animate-slide-right max-lg:flex-col max-lg:bg-[#f6faf8]'
          : 'max-lg:hidden',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-(--color-border-subtle) bg-white px-3 pb-2 pt-[max(8px,env(safe-area-inset-top))] lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Volver al chat"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100"
        >
          <X className="h-5 w-5" />
        </button>
        <span className="text-[15px] font-bold text-zinc-900">Datos del contacto</span>
        <span className="w-10" />
      </div>
      {actions && (
        <div className="border-b border-(--color-border-subtle) px-4 py-3 lg:hidden">{actions}</div>
      )}
      <div className="flex min-h-0 flex-1 overflow-y-auto lg:overflow-visible">{children}</div>
    </div>
  );
}
