'use client';

import { Button } from '@/components/ui/button';
import { Menu, Sparkles, X } from 'lucide-react';
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
    <header className="sticky top-0 z-50 w-full border-b border-[--color-border] bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5" aria-label="FUTURA">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-[13px] bg-[linear-gradient(135deg,#7139e8,#a855f7_60%,#ec4899)] text-white shadow-[0_8px_20px_-8px_rgba(113,57,232,0.9)] transition-transform duration-500 group-hover:rotate-6">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="text-[18px] font-extrabold leading-none tracking-tight text-zinc-900">
            FUTURA
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-7 text-sm text-zinc-600">
          <Link
            href="#producto"
            className="relative transition-colors hover:text-brand-700 after:absolute after:-bottom-1 after:left-0 after:h-0.5 after:w-0 after:rounded-full after:bg-[linear-gradient(90deg,#7139e8,#ec4899)] after:transition-all after:duration-300 hover:after:w-full"
          >
            Producto
          </Link>
          <Link
            href="#integraciones"
            className="relative transition-colors hover:text-brand-700 after:absolute after:-bottom-1 after:left-0 after:h-0.5 after:w-0 after:rounded-full after:bg-[linear-gradient(90deg,#7139e8,#ec4899)] after:transition-all after:duration-300 hover:after:w-full"
          >
            Integraciones
          </Link>
          <Link
            href="#precios"
            className="relative transition-colors hover:text-brand-700 after:absolute after:-bottom-1 after:left-0 after:h-0.5 after:w-0 after:rounded-full after:bg-[linear-gradient(90deg,#7139e8,#ec4899)] after:transition-all after:duration-300 hover:after:w-full"
          >
            Precios
          </Link>
          <Link
            href="/dashboard"
            className="relative transition-colors hover:text-brand-700 after:absolute after:-bottom-1 after:left-0 after:h-0.5 after:w-0 after:rounded-full after:bg-[linear-gradient(90deg,#7139e8,#ec4899)] after:transition-all after:duration-300 hover:after:w-full"
          >
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
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-zinc-600 transition-all hover:bg-brand-50 hover:text-brand-700 active:scale-95 sm:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="animate-fade-down border-t border-[--color-border] bg-white sm:hidden">
          <nav className="px-4 py-4 flex flex-col gap-1 text-sm">
            <Link
              href="#producto"
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-2.5 font-medium text-zinc-700 transition-colors hover:bg-brand-50 hover:text-brand-700"
            >
              Producto
            </Link>
            <Link
              href="#integraciones"
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-2.5 font-medium text-zinc-700 transition-colors hover:bg-brand-50 hover:text-brand-700"
            >
              Integraciones
            </Link>
            <Link
              href="#precios"
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-2.5 font-medium text-zinc-700 transition-colors hover:bg-brand-50 hover:text-brand-700"
            >
              Precios
            </Link>
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-2.5 font-medium text-zinc-700 transition-colors hover:bg-brand-50 hover:text-brand-700"
            >
              Demo
            </Link>
            <div className="mt-3 pt-3 border-t border-[--color-border] flex flex-col gap-2">
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
