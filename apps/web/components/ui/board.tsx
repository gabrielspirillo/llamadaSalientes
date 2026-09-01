import { cn } from '@/lib/cn';
import { ChevronRight, MoreHorizontal, Paperclip, Plus } from 'lucide-react';
import type * as React from 'react';

/* ============================================================================
   Tablero tipo kanban. Reproduce la anatomía del tablero de referencia:
   columna con cabecera + tarjetas pastel con etiquetas, título en el color de
   la tarjeta, nota, progreso por puntos y pie con avatares y contadores.
   ========================================================================== */

export type BoardTone = 'sky' | 'honey' | 'mint' | 'blossom' | 'grape' | 'coral';

/** Cada tono define el relleno, el borde, el color del título y el del punto. */
const TONE: Record<BoardTone, { card: string; title: string; dot: string; tag: string }> = {
  sky: {
    card: 'bg-[#e6f0ef] border-[#d3e5e3]',
    title: 'text-teal-900',
    dot: 'bg-teal-600',
    tag: 'bg-white/70 text-teal-800',
  },
  honey: {
    card: 'bg-[#eef3e9] border-[#dfe9d6]',
    title: 'text-[#4a6b3d]',
    dot: 'bg-[#7a9c5f]',
    tag: 'bg-white/70 text-[#4a6b3d]',
  },
  mint: {
    card: 'bg-[#e6f4ec] border-[#d1e9dc]',
    title: 'text-emerald-900',
    dot: 'bg-emerald-600',
    tag: 'bg-white/70 text-emerald-800',
  },
  blossom: {
    card: 'bg-[#e4f0ec] border-[#cfe4dd]',
    title: 'text-brand-900',
    dot: 'bg-brand-600',
    tag: 'bg-white/70 text-brand-800',
  },
  grape: {
    card: 'bg-[#e9f2f0] border-[#d6e7e4]',
    title: 'text-brand-800',
    dot: 'bg-brand-500',
    tag: 'bg-white/70 text-brand-700',
  },
  coral: {
    card: 'bg-[#eef2f1] border-[#e0e6e4]',
    title: 'text-[#3f544e]',
    dot: 'bg-[#7a908a]',
    tag: 'bg-white/70 text-[#3f544e]',
  },
};

/** Cabecera de columna: chevron + título + contador + acciones. */
export function BoardColumn({
  title,
  count,
  onAddHref,
  children,
  className,
}: {
  title: string;
  count?: number;
  onAddHref?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <header className="flex items-center justify-between gap-2 px-1">
        <h3 className="flex items-center gap-1 text-[16px] font-bold tracking-tight text-zinc-700">
          <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
          {title}
          {typeof count === 'number' && (
            <span className="ml-1 rounded-full bg-white px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-zinc-500 ring-1 ring-[--color-border]">
              {count}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-0.5 text-zinc-400">
          {onAddHref && (
            <a
              href={onAddHref}
              aria-label={`Añadir en ${title}`}
              className="inline-flex h-6 w-6 items-center justify-center rounded-lg transition-colors hover:bg-white hover:text-brand-600"
            >
              <Plus className="h-3.5 w-3.5" />
            </a>
          )}
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </span>
        </div>
      </header>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

/** Etiqueta `#texto` sobre el relleno de la tarjeta. */
function BoardTag({ label, tone }: { label: string; tone: BoardTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[12px] font-semibold lowercase',
        TONE[tone].tag,
      )}
    >
      <span className="opacity-55">#</span>
      {label}
    </span>
  );
}

/** Fila de puntos de progreso, como en el tablero de referencia. */
function ProgressDotRow({ value, tone }: { value: number; tone: BoardTone }) {
  const total = 14;
  const filled = Math.round((Math.max(0, Math.min(100, value)) / 100) * total);
  return (
    <div className="flex items-center gap-[3px]">
      {Array.from({ length: total }, (_, i) => ({ id: `d-${i}`, i })).map(({ id, i }) => (
        <span
          key={id}
          className={cn(
            'h-[9px] w-[9px] rounded-full transition-colors',
            i < filled ? TONE[tone].dot : 'bg-white/80',
          )}
        />
      ))}
    </div>
  );
}

export type BoardCardProps = {
  tone?: BoardTone;
  tags?: string[];
  title: string;
  /** Línea secundaria en gris, precedida de una etiqueta en negrita. */
  noteLabel?: string;
  note?: string;
  /** 0–100. Si se pasa, dibuja la fila "Progreso" con puntos. */
  progress?: number;
  progressLabel?: string;
  /** Nombres para la pila de avatares del pie. */
  people?: string[];
  /** Contadores del pie (mensajes y adjuntos en la referencia). */
  counts?: { comments?: number; attachments?: number };
  href?: string;
  children?: React.ReactNode;
  className?: string;
};

const AVATAR_BG = [
  'bg-brand-200 text-brand-800',
  'bg-emerald-200 text-emerald-800',
  'bg-teal-200 text-teal-800',
  'bg-brand-100 text-brand-700',
  'bg-emerald-100 text-emerald-700',
  'bg-teal-100 text-teal-700',
];

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

export function BoardCard({
  tone = 'grape',
  tags = [],
  title,
  noteLabel,
  note,
  progress,
  progressLabel = 'Progreso',
  people = [],
  counts,
  href,
  children,
  className,
}: BoardCardProps) {
  const t = TONE[tone];
  const Wrapper = (href ? 'a' : 'div') as 'a' | 'div';

  return (
    <Wrapper
      {...(href ? { href } : {})}
      className={cn(
        'group block rounded-[18px] border p-3.5 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'hover:-translate-y-1 hover:shadow-[0_18px_38px_-20px_rgba(20,33,29,0.45)]',
        t.card,
        className,
      )}
    >
      {/* Etiquetas + menú */}
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <BoardTag key={tag} label={tag} tone={tone} />
          ))}
        </div>
        <MoreHorizontal className="h-4 w-4 shrink-0 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      <p className={cn('text-[17px] font-semibold leading-snug', t.title)}>{title}</p>

      {note && (
        <p className="mt-1.5 text-[14px] leading-relaxed text-zinc-500">
          {noteLabel && <span className="font-semibold text-zinc-600">{noteLabel} </span>}
          {note}
        </p>
      )}

      {children}

      {progress != null && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13px] font-medium text-zinc-500">{progressLabel}</span>
            <span className="text-[13px] font-bold tabular-nums text-zinc-600">
              {Math.round(progress)}%
            </span>
          </div>
          <ProgressDotRow value={progress} tone={tone} />
        </div>
      )}

      {(people.length > 0 || counts) && (
        <div className="mt-3.5 flex items-center justify-between gap-2">
          <div className="flex items-center">
            {people.slice(0, 4).map((n, i) => (
              <span
                key={`${n}-${i}`}
                className={cn(
                  '-ml-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ring-2 ring-white first:ml-0',
                  AVATAR_BG[i % AVATAR_BG.length],
                )}
                title={n}
              >
                {initials(n)}
              </span>
            ))}
            {people.length > 4 && (
              <span className="-ml-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-[11px] font-bold text-zinc-500 ring-2 ring-white">
                +{people.length - 4}
              </span>
            )}
          </div>
          {counts && (
            <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-500">
              {counts.comments != null && (
                <span className="inline-flex items-center gap-1 rounded-md bg-white/70 px-1.5 py-0.5">
                  <MessageSquareIcon />
                  <span className="tabular-nums">{counts.comments}</span>
                </span>
              )}
              {counts.attachments != null && (
                <span className="inline-flex items-center gap-1 rounded-md bg-white/70 px-1.5 py-0.5">
                  <Paperclip className="h-3 w-3" />
                  <span className="tabular-nums">{counts.attachments}</span>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </Wrapper>
  );
}

/* Icono de mensaje del pie: el mismo trazo que el resto, en 12px. */
function MessageSquareIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      role="presentation"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** Lista de comprobación de la tarjeta (círculos marcados/sin marcar). */
export function BoardChecklist({
  items,
}: {
  items: Array<{ label: string; done: boolean }>;
}) {
  return (
    <ul className="mt-2.5 space-y-1.5">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2 text-[14px]">
          <span
            className={cn(
              'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
              it.done ? 'border-transparent bg-brand-600 text-white' : 'border-white bg-white/60',
            )}
          >
            {it.done && (
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                role="presentation"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            )}
          </span>
          <span className={cn(it.done ? 'text-zinc-600' : 'text-zinc-500')}>{it.label}</span>
        </li>
      ))}
    </ul>
  );
}
