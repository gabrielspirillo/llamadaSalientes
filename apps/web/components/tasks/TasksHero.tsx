'use client';

import { AnimatedNumber } from '@/components/ui/motion';
import { ProgressRing } from '@/components/ui/stat';
import { cn } from '@/lib/cn';
import type { TaskDTO, TaskStatsDTO } from '@/lib/tasks/types';

/**
 * Cabecera de Tareas: cuánto queda hoy (anillo) y tres números. Nada más:
 * la «carga por persona» y los porcentajes de origen se quitaron del primer
 * vistazo, que es lo que pedía la clínica («se ve raro, cuesta entenderlo»).
 */
export function TasksHero({
  tasks,
  stats,
  now,
}: {
  tasks: TaskDTO[];
  stats: TaskStatsDTO;
  now: Date;
}) {
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const doneToday = tasks.filter(
    (t) => t.status === 'DONE' && t.completedAt && new Date(t.completedAt) >= startToday,
  ).length;
  const left = stats.today;
  const total = doneToday + left;
  const pct = total > 0 ? (doneToday / total) * 100 : 0;

  const headline =
    total === 0
      ? 'Hoy no hay nada programado'
      : left === 0
        ? 'Hoy está todo hecho'
        : `Te ${left === 1 ? 'queda 1 tarea' : `quedan ${left} tareas`} para hoy`;

  return (
    <div
      data-slot="card"
      className="flex flex-col gap-5 rounded-[22px] border border-(--color-border) bg-white p-5 shadow-[var(--shadow-soft)] sm:flex-row sm:items-center sm:p-6"
    >
      <div className="flex items-center gap-4">
        <ProgressRing
          value={total === 0 ? 0 : pct}
          size={76}
          stroke={8}
          tone="mint"
          label={total === 0 ? '—' : `${doneToday}/${total}`}
        />
        <div className="min-w-0">
          <p className="text-[18px] font-semibold tracking-tight text-zinc-900">{headline}</p>
          <p className="mt-0.5 text-[13px] text-zinc-500">
            {doneToday > 0
              ? `${doneToday} ${doneToday === 1 ? 'hecha' : 'hechas'} hoy`
              : now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 sm:ml-auto sm:gap-3">
        <Metric label="Vencidas" value={stats.overdue} tone={stats.overdue > 0 ? 'rose' : 'zinc'} />
        <Metric label="Próximas" value={stats.upcoming} tone="zinc" />
        <Metric
          label="A tiempo"
          value={stats.complianceRate ?? 0}
          suffix={stats.complianceRate === null ? '' : ' %'}
          empty={stats.complianceRate === null}
          tone="mint"
        />
      </dl>
    </div>
  );
}

function Metric({
  label,
  value,
  suffix = '',
  tone,
  empty,
}: {
  label: string;
  value: number;
  suffix?: string;
  tone: 'rose' | 'mint' | 'zinc';
  empty?: boolean;
}) {
  return (
    <div
      className="min-w-0 rounded-2xl bg-zinc-50/80 px-3.5 py-2.5 sm:min-w-[112px]"
      title={label === 'A tiempo' ? 'Tareas cerradas a tiempo en los últimos 7 días' : undefined}
    >
      <dt className="text-[11.5px] font-medium text-zinc-500">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-[22px] font-bold leading-none tracking-tight tabular-nums',
          tone === 'rose'
            ? 'text-rose-600'
            : tone === 'mint'
              ? 'text-emerald-700'
              : 'text-zinc-900',
        )}
      >
        {empty ? '—' : <AnimatedNumber value={value} suffix={suffix} />}
      </dd>
    </div>
  );
}
