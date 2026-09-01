'use client';

import { AvatarStack, DueChip, EmptyState, PriorityChip } from '@/components/tasks/shared';
import { cn } from '@/lib/cn';
import { CATEGORY_META, dueTone } from '@/lib/tasks/constants';
import type { TaskDTO, TaskMember } from '@/lib/tasks/types';
import { Check, MessageCircle, Phone, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

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
}: {
  task: TaskDTO;
  members: TaskMember[];
  now: Date;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onComplete: (task: TaskDTO) => void;
}) {
  const meta = CATEGORY_META[task.category];
  const tone = dueTone(task.dueAt, now);
  const done = task.status === 'DONE';

  return (
    <li
      className={cn(
        'group flex items-start gap-3 rounded-xl border bg-white px-3.5 py-3 transition-colors hover:border-zinc-300',
        tone === 'overdue' && !done ? 'border-red-200' : 'border-zinc-200/80',
      )}
    >
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => onComplete(task)}
        aria-label={done ? 'Reabrir tarea' : 'Marcar como hecha'}
        className={cn(
          'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
          done
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : 'border-zinc-300 bg-white hover:border-emerald-500 hover:text-emerald-600',
        )}
      >
        {done ? (
          <Check className="h-3 w-3" />
        ) : (
          <Check className="h-3 w-3 opacity-0 group-hover:opacity-40" />
        )}
      </button>

      <button type="button" onClick={() => onOpen(task.id)} className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
          <span
            className={cn(
              'text-sm font-medium leading-snug text-zinc-800',
              done && 'text-zinc-400 line-through',
            )}
          >
            {task.title}
          </span>
          <PriorityChip priority={task.priority} />
          {task.requiresEvidence && (
            <ShieldCheck className="h-3 w-3 text-brand-500" aria-label="Requiere evidencia" />
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2.5 text-[12px] text-zinc-500">
          <span>{meta.label}</span>
          {task.patientName && <span className="truncate">· {task.patientName}</span>}
          {task.checklistTotal > 0 && (
            <span className="tabular-nums">
              · {task.checklistDone}/{task.checklistTotal}
            </span>
          )}
          <DueChip dueAt={task.dueAt} allDay={task.dueAllDay} now={now} />
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-2">
        {task.patientPhone && (
          <a
            href={`tel:${task.patientPhone}`}
            aria-label={`Llamar a ${task.patientName ?? 'paciente'}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          >
            <Phone className="h-3.5 w-3.5" />
          </a>
        )}
        {task.whatsappConversationId && (
          <Link
            href="/dashboard/whatsapp"
            aria-label="Abrir conversación de WhatsApp"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          >
            <MessageCircle className="h-3.5 w-3.5" />
          </Link>
        )}
        <AvatarStack ids={task.assigneeIds} members={members} max={2} />
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mi día — la pantalla que se abre a las 9:00
// ─────────────────────────────────────────────────────────────────────────────

export function MyDayView({
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
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const overdue = open.filter((t) => t.dueAt && new Date(t.dueAt) < now);
  const today = open.filter(
    (t) => t.dueAt && new Date(t.dueAt) >= now && new Date(t.dueAt) <= endOfToday,
  );
  const upcoming = open.filter((t) => t.dueAt && new Date(t.dueAt) > endOfToday);
  const undated = open.filter((t) => !t.dueAt);
  const doneToday = mine.filter(
    (t) => t.status === 'DONE' && t.completedAt && new Date(t.completedAt) >= startOfDay(now),
  );

  const groups: { key: string; title: string; hint?: string; items: TaskDTO[] }[] = [
    {
      key: 'overdue',
      title: 'Vencidas',
      hint: 'Lo primero del día: cuanto más esperan, más difícil es recuperarlas',
      items: overdue,
    },
    { key: 'today', title: 'Para hoy', items: today },
    {
      key: 'undated',
      title: 'Sin fecha',
      hint: 'Ponles fecha o no se harán nunca',
      items: undated,
    },
    { key: 'upcoming', title: 'Próximas', items: upcoming.slice(0, 20) },
  ];

  const total = open.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-full border border-zinc-200 bg-white p-0.5">
          <button
            type="button"
            onClick={() => onToggleMine(true)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              onlyMine ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-900',
            )}
          >
            Lo mío
          </button>
          <button
            type="button"
            onClick={() => onToggleMine(false)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              !onlyMine ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-900',
            )}
          >
            Toda la clínica
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          {total === 0
            ? 'Nada pendiente'
            : `${total} pendiente${total === 1 ? '' : 's'}${
                doneToday.length > 0
                  ? ` · ${doneToday.length} cerrada${doneToday.length === 1 ? '' : 's'} hoy`
                  : ''
              }`}
        </p>
      </div>

      {total === 0 && (
        <EmptyState
          title="Día limpio"
          description="No queda nada abierto en esta vista. Si la clínica acaba de empezar con Tareas, activa las rutinas para que el tablero se llene solo."
        />
      )}

      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.key}>
            <div className="mb-2 flex items-baseline gap-2">
              <h2
                className={cn(
                  'text-sm font-semibold',
                  g.key === 'overdue' ? 'text-red-600' : 'text-zinc-800',
                )}
              >
                {g.title}
              </h2>
              <span className="text-xs tabular-nums text-zinc-500">{g.items.length}</span>
              {g.hint && <span className="text-xs text-zinc-500">· {g.hint}</span>}
            </div>
            <ul className="space-y-2">
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

      {doneToday.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-500">Cerradas hoy</h2>
          <ul className="space-y-2 opacity-70">
            {doneToday.map((t) => (
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
  const maxLoad = Math.max(1, ...days.map((d) => d.items.length));

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
                    isToday ? 'text-zinc-900' : 'text-zinc-400',
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
                  style={{ width: `${Math.round((d.items.length / maxLoad) * 100)}%` }}
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
                          t.status === 'DONE' ? 'text-zinc-400 line-through' : 'text-zinc-700',
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
          <ul className="space-y-2">
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
          <ul className="space-y-2">
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
