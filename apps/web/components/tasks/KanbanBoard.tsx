'use client';

import { TaskCard } from '@/components/tasks/TaskCard';
import { cn } from '@/lib/cn';
import { STATUS_META, TASK_STATUSES, type TaskStatus } from '@/lib/tasks/constants';
import type { TaskDTO, TaskMember } from '@/lib/tasks/types';
import { Plus } from 'lucide-react';
import { useCallback, useState } from 'react';

/**
 * Tablero Kanban con drag & drop nativo (Pointer/HTML5), sin librería.
 *
 * Al soltar se manda el orden final completo de la columna destino, no un
 * índice: si dos personas arrastran a la vez, gana la última escritura y el
 * tablero queda consistente en vez de con posiciones a medias.
 */
export function KanbanBoard({
  tasks,
  members,
  now,
  canEdit,
  onOpen,
  onReorder,
  onQuickAdd,
  onComplete,
}: {
  tasks: TaskDTO[];
  members: TaskMember[];
  now: Date;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onReorder: (status: TaskStatus, orderedIds: string[]) => void;
  onQuickAdd: (status: TaskStatus) => void;
  onComplete?: (task: TaskDTO) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [target, setTarget] = useState<{ status: TaskStatus; index: number } | null>(null);

  // Ordenar por `boardPosition` es lo que hace visible la actualización
  // optimista: sin esto la card volvía a su sitio hasta que respondía el
  // servidor y el arrastre dentro de una columna parecía no hacer nada.
  const byStatus = useCallback(
    (status: TaskStatus) =>
      tasks.filter((t) => t.status === status).sort((a, b) => a.boardPosition - b.boardPosition),
    [tasks],
  );

  const handleDrop = (status: TaskStatus, index: number) => {
    const id = draggingId;
    setDraggingId(null);
    setTarget(null);
    if (!id || !canEdit) return;

    // `index` se calcula sobre la columna tal como se ve, es decir CON la card
    // arrastrada todavía dentro. Al sacarla, todo lo que estaba por debajo
    // sube una posición: si no descontamos ese hueco, cada movimiento hacia
    // abajo cae un sitio más allá del que marca el indicador.
    const ids = byStatus(status).map((t) => t.id);
    const from = ids.indexOf(id);
    let insertAt = Math.min(index, ids.length);
    if (from !== -1 && from < insertAt) insertAt -= 1;

    const next = ids.filter((x) => x !== id);
    next.splice(Math.min(insertAt, next.length), 0, id);

    // Soltar donde ya estaba no es un movimiento: no molestamos al servidor.
    const current = byStatus(status).map((t) => t.id);
    const unchanged = next.length === current.length && next.every((x, i) => x === current[i]);
    if (unchanged) return;

    onReorder(status, next);
  };

  return (
    <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-4">
      {TASK_STATUSES.map((status) => {
        const column = byStatus(status);
        const meta = STATUS_META[status];
        const isTarget = target?.status === status;

        return (
          <section
            key={status}
            onDragOver={(e) => {
              if (!canEdit || !draggingId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (!isTarget) setTarget({ status, index: column.length });
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(status, target?.status === status ? target.index : column.length);
            }}
            className={cn(
              'flex w-[300px] shrink-0 snap-start flex-col rounded-2xl border bg-zinc-50/70 transition-colors sm:w-[320px]',
              isTarget && draggingId ? 'border-zinc-300 bg-zinc-100/80' : 'border-zinc-200/70',
            )}
          >
            <header className="flex items-center gap-2 px-3.5 py-3">
              <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
              <h2 className="text-sm font-semibold text-zinc-800">{meta.label}</h2>
              <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-500 ring-1 ring-inset ring-zinc-200">
                {column.length}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onQuickAdd(status)}
                  aria-label={`Nueva tarea en ${meta.label}`}
                  className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white hover:text-zinc-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
            </header>

            <div className="flex min-h-[120px] flex-1 flex-col gap-2.5 px-2.5 pb-3">
              {column.map((task, i) => (
                <div
                  key={task.id}
                  onDragOver={(e) => {
                    if (!canEdit || !draggingId) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const after = e.clientY > rect.top + rect.height / 2;
                    const index = after ? i + 1 : i;
                    if (target?.status !== status || target.index !== index) {
                      setTarget({ status, index });
                    }
                  }}
                >
                  {isTarget && target.index === i && draggingId !== task.id && <DropPlaceholder />}
                  <TaskCard
                    task={task}
                    members={members}
                    now={now}
                    onOpen={onOpen}
                    onComplete={onComplete}
                    canEdit={canEdit}
                    draggable={canEdit}
                    dragging={draggingId === task.id}
                    onDragStart={setDraggingId}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setTarget(null);
                    }}
                  />
                </div>
              ))}

              {isTarget && target.index >= column.length && draggingId && <DropPlaceholder />}

              {column.length === 0 && !draggingId && (
                <p className="px-1 py-6 text-center text-xs text-zinc-500">
                  {status === 'TODO' ? 'Sin pendientes aquí' : meta.hint}
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DropPlaceholder() {
  return <div className="mb-2.5 h-1 rounded-full bg-zinc-300" aria-hidden="true" />;
}
