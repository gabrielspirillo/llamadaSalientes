'use client';

import { Button } from '@/components/ui/button';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export function MarketingTopbar() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-200/60 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-1.5">
          <span className="text-[18px] font-extrabold tracking-tight text-[#0f1f2e] leading-none">
            FUTURA
          </span>
          <span className="inline-block h-2 w-2 rounded-full bg-[#5fa896]" />
        </Link>

        <nav className="hidden md:flex items-center gap-7 text-sm text-zinc-600">
          <Link href="#producto" className="hover:text-zinc-900 transition-colors">
            Producto
          </Link>
          <Link href="#integraciones" className="hover:text-zinc-900 transition-colors">
            Integraciones
          </Link>
          <Link href="#precios" className="hover:text-zinc-900 transition-colors">
            Precios
          </Link>
          <Link href="/dashboard" className="hover:text-zinc-900 transition-colors">
            Demo
          </Link>
        </nav>

        <div className="hidden sm:flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Iniciar sesión</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sign-up">Empezar</Link>
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          className="sm:hidden inline-flex h-9 w-9 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100 transition-colors"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="sm:hidden border-t border-zinc-200/60 bg-white">
          <nav className="px-4 py-4 flex flex-col gap-1 text-sm">
            <Link
              href="#producto"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2.5 text-zinc-700 hover:bg-zinc-100"
            >
              Producto
            </Link>
            <Link
              href="#integraciones"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2.5 text-zinc-700 hover:bg-zinc-100"
            >
              Integraciones
            </Link>
            <Link
              href="#precios"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2.5 text-zinc-700 hover:bg-zinc-100"
            >
              Precios
            </Link>
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2.5 text-zinc-700 hover:bg-zinc-100"
            >
              Demo
            </Link>
            <div className="mt-3 pt-3 border-t border-zinc-200/60 flex flex-col gap-2">
              <Button asChild variant="secondary" size="sm" className="w-full justify-center">
                <Link href="/sign-in" onClick={() => setOpen(false)}>
                  Iniciar sesión
                </Link>
              </Button>
              <Button asChild size="sm" className="w-full justify-center">
                <Link href="/sign-up" onClick={() => setOpen(false)}>
                  Empezar
                </Link>
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
