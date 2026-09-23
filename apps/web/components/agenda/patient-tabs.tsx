'use client';

import { cn } from '@/lib/cn';
import {
  Activity,
  CalendarDays,
  ClipboardList,
  History,
  type LucideIcon,
  NotebookPen,
  Receipt,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

export type PatientTab = 'visita' | 'anamnesis' | 'historia' | 'citas' | 'contable' | 'actividad';

export const PATIENT_TABS: PatientTab[] = [
  'visita',
  'anamnesis',
  'historia',
  'citas',
  'contable',
  'actividad',
];

export function isPatientTab(value: unknown): value is PatientTab {
  return typeof value === 'string' && (PATIENT_TABS as string[]).includes(value);
}

export interface PatientTabItem {
  value: PatientTab;
  label: string;
  /** Etiqueta corta para móvil ("Hoy"). */
  shortLabel?: string;
  /** Contador de escritorio ("9/14", "3"). */
  count?: string | null;
  /** Contador de móvil: sólo lo que pide acción. Sin él, en móvil no hay contador. */
  mobileCount?: string | null;
  /** El contador avisa (ámbar): anamnesis a medias, cobros pendientes. */
  warn?: boolean;
}

const ICONS: Record<PatientTab, LucideIcon> = {
  visita: NotebookPen,
  anamnesis: ClipboardList,
  historia: History,
  citas: CalendarDays,
  contable: Receipt,
  actividad: Activity,
};

/**
 * Las pestañas de la ficha. Son subrayadas, no píldoras: las píldoras son la
 * navegación del módulo (Calendario · Pacientes · Profesionales) y se
 * confundían con éstas.
 *
 * Cada pestaña es contenido de servidor que se resuelve por URL (`?tab=`), así
 * que el cambio es una navegación: se marca la pestaña al instante
 * (optimista) y una línea animada dice que se está cargando. La barra queda
 * pegada bajo el topbar y, cuando la cabecera sale de pantalla, enseña el
 * nombre y las alertas para no perder de quién se está leyendo.
 */
export function PatientTabs({
  items,
  active,
  hrefFor,
  headerId,
  identity,
}: {
  items: PatientTabItem[];
  active: PatientTab;
  hrefFor: (tab: PatientTab) => string;
  /** Id de la cabecera: cuando deja de verse, aparece la identidad compacta. */
  headerId?: string;
  identity?: { name: string; chips: string[] };
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [optimistic, setOptimistic] = React.useOptimistic(active);
  const [compact, setCompact] = React.useState(false);

  React.useEffect(() => {
    if (!headerId) return;
    const el = document.getElementById(headerId);
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setCompact(!(entry?.isIntersecting ?? true)), {
      rootMargin: '-68px 0px 0px 0px',
      threshold: 0,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [headerId]);

  function go(tab: PatientTab, href: string) {
    if (tab === active) return;
    startTransition(() => {
      setOptimistic(tab);
      router.push(href);
    });
  }

  return (
    <div
      className={cn(
        'sticky top-[68px] z-10 -mx-4 border-b border-(--color-border) bg-white/[.94] px-4 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-9 lg:px-9',
        compact && 'shadow-[0_10px_24px_-18px_rgba(20,33,29,0.45)]',
      )}
      aria-busy={pending || undefined}
    >
      {identity && (
        <div
          className={cn(
            'flex items-center gap-2 overflow-hidden transition-[max-height,opacity,padding] duration-300',
            compact ? 'max-h-12 pt-2 opacity-100' : 'max-h-0 opacity-0',
          )}
          aria-hidden={!compact}
        >
          <span className="truncate text-[14px] font-bold text-zinc-900">{identity.name}</span>
          {identity.chips.slice(0, 3).map((chip) => (
            <span
              key={chip}
              className="hidden shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-800 ring-1 ring-rose-200 sm:inline"
            >
              {chip}
            </span>
          ))}
        </div>
      )}
      <nav
        aria-label="Secciones de la ficha"
        className="scrollbar-none -mb-px flex items-stretch gap-1 overflow-x-auto md:gap-2"
      >
        {items.map((it) => {
          const isActive = it.value === optimistic;
          const Icon = ICONS[it.value];
          const countTone = it.warn
            ? 'bg-amber-100 text-amber-800'
            : isActive
              ? 'bg-brand-100 text-brand-800'
              : 'bg-zinc-100 text-zinc-600';
          return (
            <a
              key={it.value}
              href={hrefFor(it.value)}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                go(it.value, hrefFor(it.value));
              }}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-[3px] whitespace-nowrap px-1 pb-2 pt-2 text-[11.5px] font-semibold transition-colors',
                'md:min-h-11 md:flex-none md:flex-row md:gap-1.5 md:px-2 md:pb-2.5 md:text-[14px]',
                isActive ? 'text-brand-800' : 'text-zinc-600 hover:text-zinc-900',
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0 md:hidden" aria-hidden />
              <span className="max-w-full truncate">
                {it.shortLabel ? (
                  <>
                    <span className="md:hidden">{it.shortLabel}</span>
                    <span className="hidden md:inline">{it.label}</span>
                  </>
                ) : (
                  it.label
                )}
              </span>
              {it.count && (
                <span
                  className={cn(
                    'hidden rounded-full px-1.5 py-px text-[11px] font-bold tabular-nums md:inline',
                    countTone,
                  )}
                >
                  {it.count}
                </span>
              )}
              {it.mobileCount && (
                <span
                  className={cn(
                    'absolute right-1 top-1 rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums md:hidden',
                    countTone,
                  )}
                >
                  {it.mobileCount}
                </span>
              )}
              <span
                aria-hidden
                className={cn(
                  'absolute inset-x-1 bottom-0 h-[3px] rounded-t-full transition-colors md:inset-x-0',
                  isActive ? 'bg-[linear-gradient(90deg,#37766a,#5fa896)]' : 'bg-transparent',
                  isActive && pending && 'animate-pulse',
                )}
              />
            </a>
          );
        })}
      </nav>
      {pending && <output className="sr-only">Cargando la pestaña</output>}
    </div>
  );
}
