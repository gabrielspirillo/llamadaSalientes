'use client';

import { cn } from '@/lib/cn';
import {
  CATEGORY_META,
  DUE_TONE_CLASS,
  PRIORITY_META,
  type TaskCategory,
  type TaskPriority,
  dueTone,
} from '@/lib/tasks/constants';
import type { TaskMember } from '@/lib/tasks/types';
import { AlertTriangle, Clock } from 'lucide-react';

// Piezas visuales compartidas por el tablero, "Mi día" y el panel de detalle.
// Vive aparte para que las tres vistas muestren exactamente lo mismo: una
// prioridad "urgente" tiene que verse igual en todos lados o deja de leerse.

const FALLBACK_AVATAR_COLOR = 'bg-zinc-100 text-zinc-700';

const AVATAR_COLORS = [
  'bg-sky-100 text-sky-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-violet-100 text-violet-700',
  'bg-rose-100 text-rose-700',
  'bg-orange-100 text-orange-700',
];

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? FALLBACK_AVATAR_COLOR;
}

export function Avatar({
  member,
  size = 'sm',
  ring = true,
}: {
  member: TaskMember;
  size?: 'xs' | 'sm' | 'md';
  ring?: boolean;
}) {
  const dim =
    size === 'xs'
      ? 'h-5 w-5 text-[9px]'
      : size === 'md'
        ? 'h-9 w-9 text-xs'
        : 'h-6 w-6 text-[10px]';
  return (
    <span
      title={member.name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        dim,
        colorFor(member.userId),
        ring && 'ring-2 ring-white',
      )}
    >
      {member.initials}
    </span>
  );
}

export function AvatarStack({
  ids,
  members,
  max = 3,
  size = 'sm',
}: {
  ids: string[];
  members: TaskMember[];
  max?: number;
  size?: 'xs' | 'sm' | 'md';
}) {
  const resolved = ids
    .map((id) => members.find((m) => m.userId === id))
    .filter((m): m is TaskMember => !!m);
  if (resolved.length === 0) {
    return (
      <span className="inline-flex h-6 items-center rounded-full bg-zinc-100 px-2 text-[10px] font-medium text-zinc-500">
        Sin dueño
      </span>
    );
  }
  const shown = resolved.slice(0, max);
  const rest = resolved.length - shown.length;
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((m) => (
        <Avatar key={m.userId} member={m} size={size} />
      ))}
      {rest > 0 && (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-600 ring-2 ring-white">
          +{rest}
        </span>
      )}
    </div>
  );
}

/** Barra segmentada de progreso del checklist — el detalle de la referencia. */
export function ChecklistProgress({
  done,
  total,
  category,
}: {
  done: number;
  total: number;
  category: TaskCategory;
}) {
  if (total === 0) return null;
  const meta = CATEGORY_META[category];
  const pct = Math.round((done / total) * 100);
  const segments = Math.min(total, 12);
  const filled = Math.round((done / total) * segments);
  return (
    <div className="mt-2.5">
      <div className="flex items-center justify-between text-[11px] font-medium text-zinc-500">
        <span>Progreso</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="mt-1 flex gap-[3px]" aria-label={`${done} de ${total} completado`}>
        {Array.from({ length: segments }).map((_, i) => (
          <span
            key={`seg-${category}-${
              // biome-ignore lint/suspicious/noArrayIndexKey: segmentos posicionales fijos
              i
            }`}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              i < filled ? meta.bar : 'bg-white/70',
            )}
          />
        ))}
      </div>
    </div>
  );
}

export function CategoryChip({
  category,
  variant = 'card',
}: {
  category: TaskCategory;
  variant?: 'card' | 'plain';
}) {
  const meta = CATEGORY_META[category];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
        variant === 'card' ? meta.chip : 'bg-zinc-50 text-zinc-600 ring-zinc-200',
      )}
    >
      #{meta.label.toLowerCase()}
    </span>
  );
}

export function PriorityChip({ priority }: { priority: TaskPriority }) {
  if (priority === 'LOW' || priority === 'MEDIUM') return null;
  const meta = PRIORITY_META[priority];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
        meta.chip,
      )}
    >
      {priority === 'URGENT' && <AlertTriangle className="h-2.5 w-2.5" />}
      {meta.label}
    </span>
  );
}

/** Fecha corta y humana: "hoy 10:30", "vencida · ayer", "mar 12". */
export function formatDue(
  iso: string | null,
  allDay: boolean,
  now: Date = new Date(),
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOf(d) - startOf(now)) / 86_400_000);
  const time = allDay
    ? ''
    : ` ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;

  if (dayDiff === 0) return `hoy${time}`;
  if (dayDiff === 1) return `mañana${time}`;
  if (dayDiff === -1) return `ayer${time}`;
  if (dayDiff < -1) return `hace ${Math.abs(dayDiff)} días`;
  if (dayDiff > 1 && dayDiff <= 6) {
    return `${d.toLocaleDateString('es-ES', { weekday: 'short' })}${time}`;
  }
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

export function DueChip({
  dueAt,
  allDay,
  now,
}: {
  dueAt: string | null;
  allDay: boolean;
  now?: Date;
}) {
  const label = formatDue(dueAt, allDay, now);
  if (!label) return null;
  const tone = dueTone(dueAt, now);
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-[11px] font-medium', DUE_TONE_CLASS[tone])}
    >
      <Clock className="h-3 w-3" />
      {tone === 'overdue' ? `vencida · ${label}` : label}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/50 px-6 py-12 text-center">
      <p className="text-sm font-medium text-zinc-700">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">{description}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
