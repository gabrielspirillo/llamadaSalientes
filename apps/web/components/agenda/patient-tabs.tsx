import { cn } from '@/lib/cn';
import {
  CalendarDays,
  ClipboardList,
  History,
  type LucideIcon,
  NotebookPen,
  Receipt,
} from 'lucide-react';
import Link from 'next/link';

export type PatientTab = 'visita' | 'anamnesis' | 'historia' | 'citas' | 'contable';

export const PATIENT_TABS: PatientTab[] = ['visita', 'anamnesis', 'historia', 'citas', 'contable'];

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
};

/**
 * Las pestañas de la ficha. Se resuelven por URL (`?tab=`) y no con Radix:
 * cada pestaña es contenido de servidor y sólo se pinta la activa.
 *
 * En escritorio son píldoras en fila, alineadas a la izquierda. En móvil
 * ocupan el ancho, con icono encima del texto, y quedan pegadas bajo el
 * topbar al hacer scroll: la médica cambia de pestaña con el pulgar sin volver
 * arriba.
 */
export function PatientTabs({
  items,
  active,
  hrefFor,
}: {
  items: PatientTabItem[];
  active: PatientTab;
  hrefFor: (tab: PatientTab) => string;
}) {
  return (
    <nav
      aria-label="Secciones de la ficha"
      className={cn(
        'scrollbar-none sticky top-[68px] z-10 flex w-full items-center gap-0.5 overflow-x-auto rounded-[20px] border border-[--color-border] bg-white/[.92] p-1 backdrop-blur-xl',
        'shadow-[0_10px_24px_-16px_rgba(20,33,29,0.5)]',
        'md:static md:w-auto md:gap-1 md:self-start md:rounded-full md:shadow-none',
      )}
    >
      {items.map((it) => {
        const isActive = it.value === active;
        const Icon = ICONS[it.value];
        const countTone = isActive
          ? 'bg-white/20 text-white'
          : it.warn
            ? 'bg-amber-100 text-amber-700'
            : 'bg-zinc-100 text-zinc-500';
        return (
          <Link
            key={it.value}
            href={hrefFor(it.value)}
            prefetch={false}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative flex min-h-[58px] min-w-0 flex-1 flex-col items-center justify-center gap-[3px] whitespace-nowrap rounded-2xl px-0.5 text-[11.5px] font-semibold transition-all duration-300',
              'md:min-h-[40px] md:flex-none md:flex-row md:gap-1.5 md:rounded-full md:px-4 md:text-[14px]',
              isActive
                ? 'bg-[linear-gradient(120deg,#37766a,#5fa896)] text-white shadow-[0_6px_18px_-8px_rgba(55,118,106,0.8)]'
                : 'text-zinc-500 hover:text-brand-700',
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
                  'hidden rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums md:inline',
                  countTone,
                )}
              >
                {it.count}
              </span>
            )}
            {it.mobileCount && (
              <span
                className={cn(
                  'absolute right-1.5 top-1 rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums md:hidden',
                  countTone,
                )}
              >
                {it.mobileCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
