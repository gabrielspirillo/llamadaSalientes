'use client';

import { AvatarStack, DueChip, EmptyState } from '@/components/tasks/shared';
import { cn } from '@/lib/cn';
import { CATEGORY_META, dueTone } from '@/lib/tasks/constants';
import type { TaskDTO, TaskMember } from '@/lib/tasks/types';
import { Check, MessageCircle, Phone, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Fila compacta: la usan "Mi día", la semana y la bandeja de pacientes.
// ─────────────────────────────────────────────────────────────────────────────

export function TaskRow({
  task,
  members,
  now,
  canEdit,
  onOpen,
  onComplete,
  delayMs,
}: {
  task: TaskDTO;
  members: TaskMember[];
  now: Date;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onComplete: (task: TaskDTO) => void;
  /** Entrada escalonada: retraso de la animación de aparición. */
  delayMs?: number;
}) {
  const meta = CATEGORY_META[task.category];
  const tone = dueTone(task.dueAt, now);
  const done = task.status === 'DONE';
  // Al cerrarla, el check rebota y la fila se desliza fuera ANTES de que la
  // tarea cambie de sección: si saltara de golpe, no se vería qué pasó.
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    setLeaving(false);
  }, [task.status]);

  const toggle = () => {
    const needsEvidence = !done && task.requiresEvidence && !task.evidenceNote?.trim();
    if (done || needsEvidence) {
      onComplete(task);
      return;
    }
    setLeaving(true);
    // `setLeaving(false)` va en la misma tanda que el cambio de estado: si el
    // servidor lo rechaza, la fila vuelve visible en vez de quedarse oculta.
    setTimeout(() => {
      onComplete(task);
      setLeaving(false);
    }, 480);
  };
  const checked = done || leaving;

  return (
    <li
      className={cn(
        'group flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-zinc-50',
        delayMs !== undefined && !leaving && 'animate-fade-up',
        leaving && 'task-leave',
      )}
      style={delayMs !== undefined ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      <button
        type="button"
        disabled={!canEdit || leaving}
        onClick={toggle}
        aria-label={checked ? 'Reabrir tarea' : 'Marcar como hecha'}
        className={cn(
          'inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all duration-300',
          checked
            ? 'scale-100 border-emerald-500 bg-emerald-500 text-white'
            : tone === 'overdue'
              ? 'border-rose-300 bg-white text-transparent hover:border-emerald-500 hover:text-emerald-500'
              : 'border-zinc-300 bg-white text-transparent hover:border-emerald-500 hover:text-emerald-500',
        )}
      >
        <Check className={cn('h-3 w-3', leaving && 'animate-pop')} strokeWidth={3} />
      </button>

      <button type="button" onClick={() => onOpen(task.id)} className="min-w-0 flex-1 text-left">
        <span
          className={cn(
            'block truncate text-[14px] font-medium text-zinc-800 transition-colors',
            checked && 'text-zinc-400 line-through decoration-zinc-300',
          )}
        >
          {task.title}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-zinc-500">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dot)} />
          <span className="shrink-0">{meta.label}</span>
          {task.patientName && <span className="truncate">· {task.patientName}</span>}
          {task.checklistTotal > 0 && (
            <span className="shrink-0 tabular-nums">
              · {task.checklistDone}/{task.checklistTotal}
            </span>
          )}
          {task.requiresEvidence && (
            <ShieldCheck
              className="h-3 w-3 shrink-0 text-brand-500"
              aria-label="Requiere evidencia"
            />
          )}
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1.5">
        {task.patientPhone && (
          <a
            href={`tel:${task.patientPhone}`}
            aria-label={`Llamar a ${task.patientName ?? 'paciente'}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 opacity-0 transition-all hover:bg-white hover:text-zinc-700 group-hover:opacity-100 max-md:opacity-100"
          >
            <Phone className="h-3.5 w-3.5" />
          </a>
        )}
        {task.whatsappConversationId && (
          <Link
            href="/dashboard/whatsapp"
            aria-label="Abrir conversación de WhatsApp"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 opacity-0 transition-all hover:bg-white hover:text-zinc-700 group-hover:opacity-100 max-md:opacity-100"
          >
            <MessageCircle className="h-3.5 w-3.5" />
          </Link>
        )}
        {!checked && (
          <span className="hidden sm:inline">
            <DueChip dueAt={task.dueAt} allDay={task.dueAllDay} now={now} />
          </span>
        )}
        <span className="hidden md:inline-flex">
          <AvatarStack ids={task.assigneeIds} members={members} max={2} />
        </span>
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Semana — carga por día, para ver dónde se acumula
// ─────────────────────────────────────────────────────────────────────────────

export function WeekView({
  tasks,
  members,
  now,
  canEdit,
  onOpen,
  onComplete,
}: {
  tasks: TaskDTO[];
  members: TaskMember[];
  now: Date;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onComplete: (task: TaskDTO) => void;
}) {
  const monday = startOfDay(now);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

  const days = Array.from({ length: 7 }).map((_, i) => {
    const from = new Date(monday);
    from.setDate(from.getDate() + i);
    const to = new Date(from);
    to.setHours(23, 59, 59, 999);
    return {
      date: from,
      items: tasks.filter((t) => {
        if (!t.dueAt) return false;
        const d = new Date(t.dueAt);
        return d >= from && d <= to;
      }),
    };
  });

  const undated = tasks.filter((t) => !t.dueAt && t.status !== 'DONE');
  // Medimos y coloreamos con lo MISMO: las abiertas. Antes la barra crecía
  // con las cerradas incluidas pero se pintaba en verde según las abiertas,
  // así que un día resuelto se veía cargado.
  const maxLoad = Math.max(
    1,
    ...days.map((d) => d.items.filter((t) => t.status !== 'DONE').length),
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-7">
        {days.map((d) => {
          const isToday = isSameDay(d.date, now);
          const open = d.items.filter((t) => t.status !== 'DONE');
          return (
            <div
              key={d.date.toISOString()}
              className={cn(
                'rounded-2xl border p-3',
                isToday ? 'border-zinc-900/15 bg-zinc-50' : 'border-zinc-200/70 bg-white',
              )}
            >
              <div className="flex items-baseline justify-between">
                <span
                  className={cn(
                    'text-[12px] font-semibold uppercase tracking-wide',
                    isToday ? 'text-zinc-900' : 'text-zinc-500',
                  )}
                >
                  {d.date.toLocaleDateString('es-ES', { weekday: 'short' })}
                </span>
                <span className="text-sm font-semibold tabular-nums text-zinc-700">
                  {d.date.getDate()}
                </span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-100">
                <div
                  className={cn(
                    'h-full rounded-full',
                    open.length === 0 ? 'bg-emerald-300' : 'bg-zinc-400',
                  )}
                  style={{ width: `${Math.round((open.length / maxLoad) * 100)}%` }}
                />
              </div>
              <ul className="mt-2 space-y-1">
                {d.items.slice(0, 6).map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(t.id)}
                      className="flex w-full items-start gap-1.5 rounded-lg px-1 py-1 text-left transition-colors hover:bg-zinc-100"
                    >
                      <span
                        className={cn(
                          'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                          CATEGORY_META[t.category].dot,
                        )}
                      />
                      <span
                        className={cn(
                          'line-clamp-2 text-[13px] leading-snug',
                          t.status === 'DONE' ? 'text-zinc-500 line-through' : 'text-zinc-700',
                        )}
                      >
                        {t.title}
                      </span>
                    </button>
                  </li>
                ))}
                {d.items.length > 6 && (
                  <li className="px-1 text-[12px] text-zinc-500">+{d.items.length - 6} más</li>
                )}
                {d.items.length === 0 && <li className="px-1 py-2 text-[12px] text-zinc-300">—</li>}
              </ul>
            </div>
          );
        })}
      </div>

      {undated.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-800">
            Sin fecha{' '}
            <span className="font-normal text-zinc-500">
              · no aparecen en ningún día hasta que les pongas una fecha
            </span>
          </h2>
          <ul className="rounded-[22px] border border-(--color-border) bg-white p-2 shadow-[var(--shadow-soft)]">
            {undated.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                members={members}
                now={now}
                canEdit={canEdit}
                onOpen={onOpen}
                onComplete={onComplete}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pacientes — la bandeja que factura
// ─────────────────────────────────────────────────────────────────────────────

export function PatientsView({
  tasks,
  members,
  now,
  canEdit,
  onOpen,
  onComplete,
}: {
  tasks: TaskDTO[];
  members: TaskMember[];
  now: Date;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onComplete: (task: TaskDTO) => void;
}) {
  const patientTasks = tasks.filter(
    (t) => t.status !== 'DONE' && (t.patientGhlContactId || t.patientName || t.patientPhone),
  );

  if (patientTasks.length === 0) {
    return (
      <EmptyState
        title="Ningún paciente esperando"
        description="Aquí aparecen solas las llamadas por devolver, los pacientes que no acudieron y siguen sin nueva cita, los presupuestos parados y los recordatorios sin respuesta. Si está vacío, no hay nada pendiente con pacientes."
      />
    );
  }

  // Agrupamos por persona: es como piensa quien va a llamar.
  const groups = new Map<string, { name: string; phone: string | null; items: TaskDTO[] }>();
  for (const t of patientTasks) {
    const key = t.patientGhlContactId ?? t.patientPhone ?? t.patientName ?? t.id;
    const g = groups.get(key) ?? {
      name: t.patientName ?? 'Paciente sin nombre',
      phone: t.patientPhone,
      items: [],
    };
    g.items.push(t);
    if (!g.phone && t.patientPhone) g.phone = t.patientPhone;
    groups.set(key, g);
  }

  const ordered = [...groups.entries()].sort((a, b) => {
    const aDue = earliestDue(a[1].items);
    const bDue = earliestDue(b[1].items);
    return aDue - bDue;
  });

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        {ordered.length} paciente{ordered.length === 1 ? '' : 's'} con algo pendiente ·{' '}
        {patientTasks.length} tarea{patientTasks.length === 1 ? '' : 's'}
      </p>
      {ordered.map(([key, g]) => (
        <section key={key} className="rounded-2xl border border-zinc-200/80 bg-white p-4">
          <header className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-zinc-900">{g.name}</h2>
            {g.phone && (
              <a
                href={`tel:${g.phone}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-300"
              >
                <Phone className="h-3.5 w-3.5" />
                {g.phone}
              </a>
            )}
            <span className="ml-auto text-[12px] tabular-nums text-zinc-500">
              {g.items.length} pendiente{g.items.length === 1 ? '' : 's'}
            </span>
          </header>
          <ul className="-mx-2">
            {g.items.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                members={members}
                now={now}
                canEdit={canEdit}
                onOpen={onOpen}
                onComplete={onComplete}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function earliestDue(items: TaskDTO[]): number {
  return items.reduce((min, t) => {
    const v = t.dueAt ? new Date(t.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    return Math.min(min, v);
  }, Number.MAX_SAFE_INTEGER);
}
