'use client';

import { cn } from '@/lib/cn';
import { type FinanceParams, type FinanceTab, financeHref } from '@/lib/finance/params';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * Pestañas del módulo, por URL. Resumen y Ajustes son sólo de quien
 * administra: a recepción no se le enseña una pestaña que el servidor le va a
 * negar igualmente.
 *
 * Cada pestaña es contenido de servidor, así que el cambio es una navegación:
 * se marca la pestaña al instante (optimista) y una línea animada dice que
 * está cargando. Sin eso, el clic parecía no responder hasta que llegaba el
 * HTML y la gente pulsaba dos veces.
 */
export function FinanzasNav({
  params,
  canManage,
  documentsCount,
}: {
  params: FinanceParams;
  canManage: boolean;
  documentsCount?: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [optimistic, setOptimistic] = React.useOptimistic(params.tab);

  const items: { value: FinanceTab; label: string; count?: number }[] = [
    ...(canManage ? [{ value: 'resumen' as const, label: 'Resumen' }] : []),
    { value: 'movimientos', label: 'Movimientos' },
    { value: 'documentos', label: 'Documentos', count: documentsCount },
    ...(canManage ? [{ value: 'ajustes' as const, label: 'Ajustes' }] : []),
  ];

  function go(tab: FinanceTab, href: string) {
    if (tab === params.tab) return;
    startTransition(() => {
      setOptimistic(tab);
      router.push(href);
    });
  }

  return (
    <div className="mb-5 flex flex-col gap-1.5" aria-busy={pending || undefined}>
      <nav
        aria-label="Secciones de Finanzas"
        className="scrollbar-none inline-flex max-w-full items-center gap-1 self-start overflow-x-auto rounded-full border border-(--color-border) bg-white/70 p-1 backdrop-blur-xl"
      >
        {items.map((it) => {
          const href = financeHref(params, { tab: it.value });
          const active = it.value === optimistic;
          return (
            <a
              key={it.value}
              href={href}
              aria-current={active ? 'page' : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                go(it.value, href);
              }}
              className={cn(
                'inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-[14px] font-semibold transition-all duration-300',
                active
                  ? 'bg-[linear-gradient(120deg,#37766a,#5fa896)] text-white shadow-[0_6px_18px_-8px_rgba(55,118,106,0.8)]'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-brand-700',
              )}
            >
              {it.label}
              {typeof it.count === 'number' && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[11px] tabular-nums',
                    active ? 'bg-white/20 text-white' : 'bg-zinc-100 text-zinc-600',
                  )}
                >
                  {it.count}
                </span>
              )}
            </a>
          );
        })}
      </nav>
      <div className="h-0.5 w-full max-w-[420px] overflow-hidden rounded-full" aria-hidden>
        <div
          className={cn(
            'h-full w-1/3 rounded-full bg-[linear-gradient(90deg,#37766a,#6bc2a4)] transition-opacity',
            pending ? 'animate-shimmer opacity-100' : 'opacity-0',
          )}
        />
      </div>
    </div>
  );
}
