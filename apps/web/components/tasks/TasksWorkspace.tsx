'use client';

import { PageHeader } from '@/components/dashboard/page-header';
import { KanbanBoard } from '@/components/tasks/KanbanBoard';
import { QuickAdd } from '@/components/tasks/QuickAdd';
import { RoutinesView } from '@/components/tasks/RoutinesView';
import { TaskComposer } from '@/components/tasks/TaskComposer';
import { TaskDetailPanel } from '@/components/tasks/TaskDetailPanel';
import { TasksHero } from '@/components/tasks/TasksHero';
import { TodayView } from '@/components/tasks/TodayView';
import { Avatar } from '@/components/tasks/shared';
import { PatientsView, WeekView } from '@/components/tasks/views';
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
  ClipboardCheck,
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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

type ViewKey = 'board' | 'day' | 'week' | 'routines' | 'patients';

const VIEWS: { key: ViewKey; label: string; icon: typeof Columns3 }[] = [
  { key: 'day', label: 'Hoy', icon: Sun },
  { key: 'board', label: 'Tablero', icon: Columns3 },
  { key: 'week', label: 'Semana', icon: CalendarDays },
  { key: 'patients', label: 'Pacientes', icon: Users },
  { key: 'routines', label: 'Rutinas', icon: Repeat },
];

export function TasksWorkspace({
  initialTasks,
  initialStats,
  members,
  templates: initialTemplates,
  rules: initialRules,
  currentUserId,
  role,
  timezone,
  initialView = 'day',
}: {
  timezone?: string | null;
  /** Vista con la que abre (por defecto «Hoy»). */
  initialView?: ViewKey;
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
  const [templates, setTemplates] = useState<TaskTemplateDTO[]>(initialTemplates);
  const [rules, setRules] = useState<TaskAutomationRuleDTO[]>(initialRules);
  const [view, setView] = useState<ViewKey>(initialView);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Aviso que se muestra dentro del panel al abrirlo (no detrás de él). */
  const [panelNotice, setPanelNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<TaskCategory | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | null>(null);
  const [sourceFilter, setSourceFilter] = useState<TaskSource | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [quickAddStatus, setQuickAddStatus] = useState<TaskStatus | null>(null);
  /** Alta completa: null cerrado; si no, la columna destino y el texto inicial. */
  const [composer, setComposer] = useState<{ status: TaskStatus; text?: string } | null>(null);
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

  /**
   * Recarga rutinas y automatizaciones sin tirar la página entera.
   * Antes hacía `window.location.reload()`, así que tocar tres ajustes eran
   * tres recargas y tres vueltas al Tablero.
   */
  const refreshRoutines = useCallback(async () => {
    try {
      const [tplRes, ruleRes] = await Promise.all([
        fetch('/api/tasks/templates', { cache: 'no-store' }),
        fetch('/api/tasks/automations', { cache: 'no-store' }),
      ]);
      const tpl = (await tplRes.json()) as { templates?: TaskTemplateDTO[] };
      const rl = (await ruleRes.json()) as { rules?: TaskAutomationRuleDTO[] };
      if (tpl.templates) setTemplates(tpl.templates);
      if (rl.rules) setRules(rl.rules);
      void refresh();
    } catch (err) {
      setError((err as Error).message);
    }
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
    (assigneeFilter ? 1 : 0) +
    (query.trim() ? 1 : 0);

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
      // El panel se abre a pantalla completa y tapaba el banner de error, así
      // que el aviso viaja dentro del panel, junto al campo que hay que
      // rellenar. Es el mensaje más importante del módulo.
      setPanelNotice(
        'Para cerrarla hace falta dejar constancia: escribe abajo qué se hizo (número de ciclo, importe cuadrado, resultado del control) y vuelve a marcarla.',
      );
      setSelectedId(task.id);
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

  /** Abrir una tarea desde el tablero o las listas: sin aviso pendiente. */
  const openTask = (id: string) => {
    setPanelNotice(null);
    setSelectedId(id);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operativa diaria"
        title="Tareas"
        description="Lo que hay que hacer hoy con los pacientes y con la clínica."
        icon={<ClipboardCheck className="h-5 w-5" />}
        actions={
          canEdit ? (
            <Button onClick={() => setComposer({ status: 'TODO' })}>
              <Plus className="h-4 w-4" />
              Nueva tarea
            </Button>
          ) : undefined
        }
      />

      <TasksHero tasks={tasks} stats={stats} now={now} />

      {/* ── Vistas + búsqueda ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <ViewSwitch value={view} onChange={setView} />

        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1 md:w-64 md:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar tarea o paciente"
              className="lg-field w-full rounded-full border border-zinc-200 bg-white py-2 pl-9 pr-3 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors',
              activeFilters > 0 || showFilters
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
          {refreshing && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />}
        </div>
      </div>

      {/* ── Filtros ──────────────────────────────────────────────────────── */}
      {showFilters && (
        <div className="animate-fade-up space-y-3 rounded-[22px] border border-(--color-border) bg-white p-4 shadow-[var(--shadow-soft)]">
          {members.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-24 text-[12px] font-semibold text-zinc-500">Persona</span>
              {members.map((m) => (
                <button
                  key={m.userId}
                  type="button"
                  onClick={() => setAssigneeFilter((cur) => (cur === m.userId ? null : m.userId))}
                  title={`Filtrar por ${m.name}`}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-[12px] font-medium transition-colors',
                    assigneeFilter === m.userId
                      ? 'border-zinc-900 bg-zinc-900 text-white'
                      : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300',
                  )}
                >
                  <Avatar member={m} size="xs" ring={false} />
                  {m.name.split(' ')[0]}
                </button>
              ))}
            </div>
          )}
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
                setQuery('');
              }}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-zinc-500 hover:text-zinc-900"
            >
              <X className="h-3 w-3" />
              Limpiar filtros
            </button>
          )}
        </div>
      )}

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
          timezone={timezone}
          members={members}
          status={quickAddStatus}
          onCreated={() => void refresh()}
          onCancel={() => setQuickAddStatus(null)}
          onExpand={(text) => {
            const status = quickAddStatus;
            setQuickAddStatus(null);
            setComposer({ status, text });
          }}
        />
      )}

      {view === 'board' && (
        <KanbanBoard
          tasks={filtered}
          members={members}
          now={now}
          canEdit={canEdit}
          onOpen={openTask}
          onReorder={(status, ids) => void handleReorder(status, ids)}
          onQuickAdd={(status) => setQuickAddStatus(status)}
          onComplete={(t) => void handleComplete(t)}
        />
      )}

      {view === 'day' && (
        <TodayView
          tasks={filtered}
          members={members}
          now={now}
          canEdit={canEdit}
          currentUserId={currentUserId}
          onlyMine={onlyMine}
          onToggleMine={setOnlyMine}
          onOpen={openTask}
          onComplete={(t) => void handleComplete(t)}
        />
      )}

      {view === 'week' && (
        <WeekView
          tasks={filtered}
          members={members}
          now={now}
          canEdit={canEdit}
          onOpen={openTask}
          onComplete={(t) => void handleComplete(t)}
        />
      )}

      {view === 'patients' && (
        <PatientsView
          tasks={filtered}
          members={members}
          now={now}
          canEdit={canEdit}
          onOpen={openTask}
          onComplete={(t) => void handleComplete(t)}
        />
      )}

      {view === 'routines' && (
        <RoutinesView
          templates={templates}
          rules={rules}
          members={members}
          isAdmin={isAdmin}
          onRefresh={() => void refreshRoutines()}
        />
      )}

      {composer && canEdit && (
        <TaskComposer
          open
          onOpenChange={(v) => {
            if (!v) setComposer(null);
          }}
          members={members}
          defaultStatus={composer.status}
          initialText={composer.text}
          onCreated={() => void refresh()}
        />
      )}

      {selectedId && (
        <TaskDetailPanel
          taskId={selectedId}
          members={members}
          canEdit={canEdit}
          notice={panelNotice}
          onClose={() => {
            setSelectedId(null);
            setPanelNotice(null);
          }}
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
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-24 text-[12px] font-semibold text-zinc-500">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(value === o.value ? null : o.value)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors',
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

/**
 * Pestañas con una píldora que se desliza hasta la elegida (sólo `transform`).
 * En móvil la fila se desliza de lado si no cabe.
 */
function ViewSwitch({ value, onChange }: { value: ViewKey; onChange: (v: ViewKey) => void }) {
  const refs = useRef(new Map<ViewKey, HTMLButtonElement>());
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current.get(value);
      if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [value]);

  return (
    <nav className="-mx-1 max-w-full overflow-x-auto px-1 [scrollbar-width:none]">
      <div className="relative inline-flex rounded-full bg-zinc-100 p-1">
        {pill && (
          <span
            aria-hidden
            className="absolute top-1 bottom-1 left-0 rounded-full bg-white shadow-[0_2px_8px_-2px_rgba(16,24,40,0.15)] transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ width: pill.w, transform: `translateX(${pill.x}px)` }}
          />
        )}
        {VIEWS.map((v) => {
          const Icon = v.icon;
          const active = v.key === value;
          return (
            <button
              key={v.key}
              ref={(el) => {
                if (el) refs.current.set(v.key, el);
              }}
              type="button"
              onClick={() => onChange(v.key)}
              aria-pressed={active}
              className={cn(
                'relative z-10 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                active ? 'text-zinc-900' : 'text-zinc-500 hover:text-zinc-800',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {v.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
