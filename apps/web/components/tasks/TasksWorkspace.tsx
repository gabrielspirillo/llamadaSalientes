'use client';

import { KanbanBoard } from '@/components/tasks/KanbanBoard';
import { QuickAdd } from '@/components/tasks/QuickAdd';
import { RoutinesView } from '@/components/tasks/RoutinesView';
import { StatsBar } from '@/components/tasks/StatsBar';
import { TaskDetailPanel } from '@/components/tasks/TaskDetailPanel';
import { Avatar } from '@/components/tasks/shared';
import { MyDayView, PatientsView, WeekView } from '@/components/tasks/views';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  CATEGORY_META,
  PRIORITY_META,
  SOURCE_META,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_SOURCES,
  type TaskCategory,
  type TaskPriority,
  type TaskSource,
  type TaskStatus,
} from '@/lib/tasks/constants';
import type {
  TaskAutomationRuleDTO,
  TaskDTO,
  TaskMember,
  TaskStatsDTO,
  TaskTemplateDTO,
} from '@/lib/tasks/types';
import {
  CalendarDays,
  Columns3,
  Filter,
  Loader2,
  Plus,
  Repeat,
  Search,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

type ViewKey = 'board' | 'day' | 'week' | 'routines' | 'patients';

const VIEWS: { key: ViewKey; label: string; icon: typeof Columns3 }[] = [
  { key: 'board', label: 'Tablero', icon: Columns3 },
  { key: 'day', label: 'Mi día', icon: Sun },
  { key: 'week', label: 'Semana', icon: CalendarDays },
  { key: 'patients', label: 'Pacientes', icon: Users },
  { key: 'routines', label: 'Rutinas', icon: Repeat },
];

export function TasksWorkspace({
  initialTasks,
  initialStats,
  members,
  templates,
  rules,
  currentUserId,
  role,
}: {
  initialTasks: TaskDTO[];
  initialStats: TaskStatsDTO;
  members: TaskMember[];
  templates: TaskTemplateDTO[];
  rules: TaskAutomationRuleDTO[];
  currentUserId: string | null;
  role: 'admin' | 'operator' | 'viewer';
}) {
  const [tasks, setTasks] = useState<TaskDTO[]>(initialTasks);
  const [stats, setStats] = useState<TaskStatsDTO>(initialStats);
  const [view, setView] = useState<ViewKey>('board');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<TaskCategory | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | null>(null);
  const [sourceFilter, setSourceFilter] = useState<TaskSource | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [quickAddStatus, setQuickAddStatus] = useState<TaskStatus | null>(null);
  const [onlyMine, setOnlyMine] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `now` se congela por render y se refresca con los datos: si lo calculáramos
  // en cada card, el semáforo de vencimiento parpadearía entre tarjetas.
  const [now, setNow] = useState(() => new Date());

  const canEdit = role !== 'viewer';
  const isAdmin = role === 'admin';

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/tasks', { cache: 'no-store' });
      const data = (await res.json()) as {
        tasks?: TaskDTO[];
        stats?: TaskStatsDTO;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'No se pudieron cargar las tareas');
      if (data.tasks) setTasks(data.tasks);
      if (data.stats) setStats(data.stats);
      setNow(new Date());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Refresco en vivo mientras la pestaña está a la vista. El tablero es
  // compartido: si recepción cierra algo, el resto tiene que verlo.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const iv = setInterval(tick, 45_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (categoryFilter && t.category !== categoryFilter) return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (sourceFilter && t.source !== sourceFilter) return false;
      if (assigneeFilter && !t.assigneeIds.includes(assigneeFilter)) return false;
      if (q) {
        const haystack = [t.title, t.description ?? '', t.patientName ?? '', ...t.labels]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, query, categoryFilter, priorityFilter, sourceFilter, assigneeFilter]);

  const activeFilters =
    (categoryFilter ? 1 : 0) +
    (priorityFilter ? 1 : 0) +
    (sourceFilter ? 1 : 0) +
    (assigneeFilter ? 1 : 0);

  /** Drag & drop: optimista, con vuelta atrás si el servidor rechaza. */
  const handleReorder = async (status: TaskStatus, orderedIds: string[]) => {
    const snapshot = tasks;
    setTasks((prev) =>
      prev.map((t) => {
        const idx = orderedIds.indexOf(t.id);
        if (idx === -1) return t;
        return { ...t, status, boardPosition: (idx + 1) * 1000 };
      }),
    );
    try {
      const res = await fetch('/api/tasks/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, orderedIds }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'No se pudo mover la tarea');
      }
      void refresh();
    } catch (err) {
      setTasks(snapshot);
      setError((err as Error).message);
    }
  };

  /** Check rápido desde las listas: cierra o reabre sin abrir el panel. */
  const handleComplete = async (task: TaskDTO) => {
    const nextStatus: TaskStatus = task.status === 'DONE' ? 'TODO' : 'DONE';
    if (nextStatus === 'DONE' && task.requiresEvidence && !task.evidenceNote?.trim()) {
      setSelectedId(task.id);
      setError('Esta tarea exige una nota de evidencia antes de cerrarse.');
      return;
    }
    const snapshot = tasks;
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? {
              ...t,
              status: nextStatus,
              completedAt: nextStatus === 'DONE' ? new Date().toISOString() : null,
            }
          : t,
      ),
    );
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'No se pudo actualizar');
      }
      void refresh();
    } catch (err) {
      setTasks(snapshot);
      setError((err as Error).message);
    }
  };

  const today = new Date();

  return (
    <div className="space-y-5">
      {/* ── Cabecera ─────────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold capitalize tracking-tight text-zinc-900">
            {today.toLocaleDateString('es-ES', { month: 'long' })}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Hoy es{' '}
            {today.toLocaleDateString('es-ES', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 xl:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar tarea o paciente"
              className="w-full rounded-full border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition-colors',
              activeFilters > 0
                ? 'border-zinc-900 bg-zinc-900 text-white'
                : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300',
            )}
          >
            <Filter className="h-3.5 w-3.5" />
            Filtros
            {activeFilters > 0 && (
              <span className="rounded-full bg-white/20 px-1.5 tabular-nums">{activeFilters}</span>
            )}
          </button>

          <div className="hidden items-center -space-x-1.5 sm:flex">
            {members.slice(0, 5).map((m) => (
              <button
                key={m.userId}
                type="button"
                onClick={() => setAssigneeFilter((cur) => (cur === m.userId ? null : m.userId))}
                title={`Filtrar por ${m.name}`}
                className={cn(
                  'rounded-full transition-transform hover:z-10 hover:-translate-y-0.5',
                  assigneeFilter === m.userId && 'ring-2 ring-zinc-900',
                )}
              >
                <Avatar member={m} size="md" />
              </button>
            ))}
          </div>

          {canEdit && (
            <Button size="sm" onClick={() => setQuickAddStatus('TODO')}>
              <Plus className="h-3.5 w-3.5" />
              Nueva tarea
            </Button>
          )}
        </div>
      </header>

      {/* ── Filtros ──────────────────────────────────────────────────────── */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-3">
          <FilterGroup
            label="Categoría"
            options={TASK_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_META[c].label }))}
            value={categoryFilter}
            onChange={(v) => setCategoryFilter(v as TaskCategory | null)}
          />
          <FilterGroup
            label="Prioridad"
            options={TASK_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label }))}
            value={priorityFilter}
            onChange={(v) => setPriorityFilter(v as TaskPriority | null)}
          />
          <FilterGroup
            label="Origen"
            options={TASK_SOURCES.map((s) => ({ value: s, label: SOURCE_META[s].label }))}
            value={sourceFilter}
            onChange={(v) => setSourceFilter(v as TaskSource | null)}
          />
          {activeFilters > 0 && (
            <button
              type="button"
              onClick={() => {
                setCategoryFilter(null);
                setPriorityFilter(null);
                setSourceFilter(null);
                setAssigneeFilter(null);
              }}
              className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900"
            >
              <X className="h-3 w-3" />
              Limpiar
            </button>
          )}
        </div>
      )}

      <StatsBar stats={stats} members={members} />

      {/* ── Vistas ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="inline-flex rounded-full border border-zinc-200 bg-white p-0.5">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  view === v.key ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-900',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 text-xs text-zinc-400">
          {refreshing && <Loader2 className="h-3 w-3 animate-spin" />}
          <span>En vivo · cada 45s</span>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-2 text-xs text-red-700">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Cerrar aviso">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {quickAddStatus && canEdit && (
        <QuickAdd
          members={members}
          status={quickAddStatus}
          onCreated={() => void refresh()}
          onCancel={() => setQuickAddStatus(null)}
        />
      )}

      {view === 'board' && (
        <KanbanBoard
          tasks={filtered}
          members={members}
          now={now}
          canEdit={canEdit}
          onOpen={setSelectedId}
          onReorder={(status, ids) => void handleReorder(status, ids)}
          onQuickAdd={(status) => setQuickAddStatus(status)}
        />
      )}

      {view === 'day' && (
        <MyDayView
          tasks={filtered}
          members={members}
          now={now}
          canEdit={canEdit}
          currentUserId={currentUserId}
          onlyMine={onlyMine}
          onToggleMine={setOnlyMine}
          onOpen={setSelectedId}
          onComplete={(t) => void handleComplete(t)}
        />
      )}

      {view === 'week' && (
        <WeekView
          tasks={filtered}
          members={members}
          now={now}
          canEdit={canEdit}
          onOpen={setSelectedId}
          onComplete={(t) => void handleComplete(t)}
        />
      )}

      {view === 'patients' && (
        <PatientsView
          tasks={filtered}
          members={members}
          now={now}
          canEdit={canEdit}
          onOpen={setSelectedId}
          onComplete={(t) => void handleComplete(t)}
        />
      )}

      {view === 'routines' && (
        <RoutinesView
          templates={templates}
          rules={rules}
          members={members}
          isAdmin={isAdmin}
          onRefresh={() => window.location.reload()}
        />
      )}

      {selectedId && (
        <TaskDetailPanel
          taskId={selectedId}
          members={members}
          canEdit={canEdit}
          onClose={() => setSelectedId(null)}
          onChanged={() => void refresh()}
        />
      )}
    </div>
  );
}

function FilterGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[13px] font-semibold uppercase tracking-wide text-zinc-400">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(value === o.value ? null : o.value)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[13px] font-medium transition-colors',
              value === o.value
                ? 'border-zinc-900 bg-zinc-900 text-white'
                : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
