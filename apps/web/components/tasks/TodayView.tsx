'use client';

import { TaskRow } from '@/components/tasks/views';
import { cn } from '@/lib/cn';
import type { TaskDTO, TaskMember } from '@/lib/tasks/types';
import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';

/**
 * «Hoy»: la vista por defecto de Tareas. Pocas secciones, cada una con las
 * cinco primeras a la vista y el resto tras «Ver N más»: con cientos de
 * tareas la página ya no es un scroll infinito.
 */

const PREVIEW = 5;

type Group = {
  key: string;
  title: string;
  tone: 'rose' | 'brand' | 'zinc';
  items: TaskDTO[];
  /** Se abre plegada (sólo el título y el número). */
  collapsed?: boolean;
};

export function TodayView({
  tasks,
  members,
  now,
  canEdit,
  currentUserId,
  onlyMine,
  onToggleMine,
  onOpen,
  onComplete,
}: {
  tasks: TaskDTO[];
  members: TaskMember[];
  now: Date;
  canEdit: boolean;
  currentUserId: string | null;
  onlyMine: boolean;
  onToggleMine: (v: boolean) => void;
  onOpen: (id: string) => void;
  onComplete: (task: TaskDTO) => void;
}) {
  const mine = tasks.filter(
    (t) =>
      !onlyMine ||
      !currentUserId ||
      t.assigneeIds.includes(currentUserId) ||
      t.assigneeIds.length === 0,
  );
  const open = mine.filter((t) => t.status !== 'DONE');
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(now);
  endToday.setHours(23, 59, 59, 999);
  const endWeek = new Date(endToday.getTime() + 7 * 86_400_000);
  const due = (t: TaskDTO) => (t.dueAt ? new Date(t.dueAt).getTime() : null);
  const byDue = (a: TaskDTO, b: TaskDTO) => (due(a) ?? 0) - (due(b) ?? 0);

  const overdue = open
    .filter((t) => (due(t) ?? Number.POSITIVE_INFINITY) < now.getTime())
    .sort((a, b) => byDue(b, a));
  const today = open
    .filter((t) => {
      const d = due(t);
      return d !== null && d >= now.getTime() && d <= endToday.getTime();
    })
    .sort(byDue);
  const upcoming = open
    .filter((t) => {
      const d = due(t);
      return d !== null && d > endToday.getTime() && d <= endWeek.getTime();
    })
    .sort(byDue);
  const undated = open.filter((t) => due(t) === null);
  const doneToday = mine.filter(
    (t) => t.status === 'DONE' && t.completedAt && new Date(t.completedAt) >= startToday,
  );

  const groups: Group[] = [
    { key: 'today', title: 'Para hoy', tone: 'brand', items: today },
    { key: 'overdue', title: 'Vencidas', tone: 'rose', items: overdue },
    { key: 'upcoming', title: 'Próximos 7 días', tone: 'zinc', items: upcoming },
    { key: 'undated', title: 'Sin fecha', tone: 'zinc', items: undated },
    { key: 'done', title: 'Hechas hoy', tone: 'zinc', items: doneToday },
  ].filter((g) => g.items.length > 0) as Group[];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative inline-grid grid-cols-2 rounded-full bg-zinc-100 p-1 text-[13px] font-medium">
          <span
            aria-hidden
            className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-white shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ transform: onlyMine ? 'translateX(0)' : 'translateX(100%)' }}
          />
          {[
            { v: true, label: 'Lo mío' },
            { v: false, label: 'Toda la clínica' },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => onToggleMine(o.v)}
              className={cn(
                'relative z-10 rounded-full px-4 py-1.5 transition-colors',
                onlyMine === o.v ? 'text-zinc-900' : 'text-zinc-500 hover:text-zinc-800',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {open.length === 0 && <AllClear />}
      {groups.length > 0 && (
        <div className="space-y-3">
          {groups.map((g, i) => (
            <Section
              key={`${g.key}-${onlyMine}`}
              group={g}
              index={i}
              members={members}
              now={now}
              canEdit={canEdit}
              onOpen={onOpen}
              onComplete={onComplete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const TONE: Record<Group['tone'], { dot: string; title: string; count: string }> = {
  rose: { dot: 'bg-rose-500', title: 'text-rose-700', count: 'bg-rose-50 text-rose-700' },
  brand: { dot: 'bg-emerald-500', title: 'text-zinc-900', count: 'bg-emerald-50 text-emerald-700' },
  zinc: { dot: 'bg-zinc-300', title: 'text-zinc-700', count: 'bg-zinc-100 text-zinc-600' },
};

function Section({
  group,
  index,
  members,
  now,
  canEdit,
  onOpen,
  onComplete,
}: {
  group: Group;
  index: number;
  members: TaskMember[];
  now: Date;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onComplete: (task: TaskDTO) => void;
}) {
  const [open, setOpen] = useState(!group.collapsed);
  const [all, setAll] = useState(false);
  const tone = TONE[group.tone];
  const shown = all ? group.items : group.items.slice(0, PREVIEW);
  const rest = group.items.length - shown.length;

  return (
    <section
      data-slot="card"
      className="animate-fade-up overflow-hidden rounded-[22px] border border-(--color-border) bg-white shadow-[var(--shadow-soft)]"
      style={{ animationDelay: `${Math.min(index * 70, 300)}ms` }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-5 py-3.5 text-left"
      >
        <span className={cn('h-2 w-2 rounded-full', tone.dot)} />
        <h2 className={cn('text-[14px] font-semibold', tone.title)}>{group.title}</h2>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums',
            tone.count,
          )}
        >
          {group.items.length}
        </span>
        <ChevronDown
          className={cn(
            'ml-auto h-4 w-4 text-zinc-400 transition-transform duration-300',
            open ? 'rotate-0' : '-rotate-90',
          )}
        />
      </button>

      {open && (
        <div className="border-t border-(--color-border-subtle) px-2 pb-2 pt-1">
          <ul>
            {shown.map((t, i) => (
              <TaskRow
                key={t.id}
                task={t}
                members={members}
                now={now}
                canEdit={canEdit}
                onOpen={onOpen}
                onComplete={onComplete}
                delayMs={Math.min(i * 35, 300)}
              />
            ))}
          </ul>
          {(rest > 0 || all) && group.items.length > PREVIEW && (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className="mx-3 mb-1 mt-1 rounded-full px-3 py-1.5 text-[13px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
            >
              {all ? 'Ver menos' : `Ver ${rest} más`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function AllClear() {
  return (
    <div
      data-slot="card"
      className="flex flex-col items-center rounded-[22px] border border-(--color-border) bg-white px-6 py-14 text-center shadow-[var(--shadow-soft)]"
    >
      <span className="inline-flex h-16 w-16 animate-pop items-center justify-center rounded-full bg-emerald-50 ring-8 ring-emerald-50/50">
        <Check className="h-8 w-8 text-emerald-600" strokeWidth={2.5} />
      </span>
      <p className="mt-5 text-[17px] font-semibold text-zinc-900">Todo al día</p>
      <p className="mt-1 max-w-sm text-[14px] text-zinc-500">
        No queda nada pendiente en esta vista.
      </p>
    </div>
  );
}
