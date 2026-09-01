'use client';

import {
  AvatarStack,
  CategoryChip,
  ChecklistProgress,
  DueChip,
  PriorityChip,
} from '@/components/tasks/shared';
import { cn } from '@/lib/cn';
import { CATEGORY_META, SOURCE_META, dueTone } from '@/lib/tasks/constants';
import type { TaskDTO, TaskMember } from '@/lib/tasks/types';
import { Bot, CheckSquare, MessageSquare, Phone, Repeat, ShieldCheck, User } from 'lucide-react';

/**
 * La card del tablero. Todo lo que una persona necesita para decidir si esta
 * es la tarea que hace ahora, sin abrirla: categoría, urgencia, progreso,
 * quién la tiene y cuándo vence.
 */
export function TaskCard({
  task,
  members,
  now,
  onOpen,
  onDragStart,
  onDragEnd,
  dragging,
  draggable = true,
}: {
  task: TaskDTO;
  members: TaskMember[];
  now: Date;
  onOpen: (id: string) => void;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
  dragging?: boolean;
  draggable?: boolean;
}) {
  const meta = CATEGORY_META[task.category];
  const tone = dueTone(task.dueAt, now);
  const isDone = task.status === 'DONE';

  return (
    <article
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', task.id);
        onDragStart?.(task.id);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(task.id);
        }
      }}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: la card es el control
      tabIndex={0}
      className={cn(
        'group cursor-pointer rounded-2xl border p-3.5 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-all',
        'hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-8px_rgba(16,24,40,0.18)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/15',
        meta.card,
        dragging && 'opacity-40',
        isDone && 'opacity-70',
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <CategoryChip category={task.category} />
        <PriorityChip priority={task.priority} />
        {task.labels.slice(0, 2).map((l) => (
          <span
            key={l}
            className="inline-flex items-center rounded-full bg-white/70 px-2 py-0.5 text-[12px] font-medium text-zinc-500 ring-1 ring-inset ring-white"
          >
            #{l}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-1 text-zinc-400">
          {task.source === 'AUTOMATION' && (
            <Bot className="h-3.5 w-3.5" aria-label={SOURCE_META.AUTOMATION.hint} />
          )}
          {task.source === 'ROUTINE' && (
            <Repeat className="h-3.5 w-3.5" aria-label={SOURCE_META.ROUTINE.hint} />
          )}
          {task.requiresEvidence && (
            <ShieldCheck className="h-3.5 w-3.5" aria-label="Requiere evidencia para cerrarse" />
          )}
        </span>
      </div>

      <h3
        className={cn(
          'mt-2 text-[16px] font-semibold leading-snug text-zinc-800',
          isDone && 'line-through decoration-zinc-400',
        )}
      >
        {task.title}
      </h3>

      {task.description && (
        <p className="mt-1 line-clamp-2 text-[14px] leading-relaxed text-zinc-500">
          {task.description}
        </p>
      )}

      {task.patientName && (
        <div className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-lg bg-white/70 px-2 py-1 text-[13px] font-medium text-zinc-600">
          <User className="h-3 w-3 shrink-0 text-zinc-400" />
          <span className="truncate">{task.patientName}</span>
          {task.patientPhone && (
            <span className="shrink-0 text-zinc-400">· {task.patientPhone}</span>
          )}
        </div>
      )}

      <ChecklistProgress
        done={task.checklistDone}
        total={task.checklistTotal}
        category={task.category}
      />

      <div className="mt-3 flex items-center justify-between gap-2">
        <AvatarStack ids={task.assigneeIds} members={members} />
        <div className="flex items-center gap-2.5 text-[13px] text-zinc-500">
          {task.checklistTotal > 0 && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <CheckSquare className="h-3 w-3" />
              {task.checklistDone}/{task.checklistTotal}
            </span>
          )}
          {task.commentCount > 0 && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <MessageSquare className="h-3 w-3" />
              {task.commentCount}
            </span>
          )}
          {task.callId && <Phone className="h-3 w-3" aria-label="Viene de una llamada" />}
        </div>
      </div>

      {task.dueAt && (
        <div
          className={cn(
            'mt-2 border-t pt-2',
            tone === 'overdue' ? 'border-red-200/70' : 'border-white/80',
          )}
        >
          <DueChip dueAt={task.dueAt} allDay={task.dueAllDay} now={now} />
        </div>
      )}
    </article>
  );
}
