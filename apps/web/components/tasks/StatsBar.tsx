'use client';

import { Avatar } from '@/components/tasks/shared';
import { cn } from '@/lib/cn';
import type { TaskMember, TaskStatsDTO } from '@/lib/tasks/types';
import { Bot, Clock, Flame, Repeat, TrendingUp } from 'lucide-react';

/**
 * La franja de arriba responde una sola pregunta: ¿la clínica está al día?
 *
 * No son métricas de vanidad. "Vencidas" y "% de cumplimiento" son las dos que
 * hacen que delegar deje de ser un acto de fe.
 */
export function StatsBar({
  stats,
  members,
}: {
  stats: TaskStatsDTO;
  members: TaskMember[];
}) {
  const total = stats.manual + stats.routine + stats.automated;
  const autoShare = total > 0 ? Math.round(((stats.routine + stats.automated) / total) * 100) : 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        icon={<Flame className="h-4 w-4" />}
        label="Vencidas"
        value={stats.overdue}
        tone={stats.overdue === 0 ? 'good' : stats.overdue > 5 ? 'bad' : 'warn'}
        hint={stats.overdue === 0 ? 'Nada sin cerrar de otros días' : 'Lo primero de la mañana'}
      />
      <Tile
        icon={<Clock className="h-4 w-4" />}
        label="Para hoy"
        value={stats.today}
        tone="neutral"
        hint={`${stats.upcoming} más en los próximos días`}
      />
      <Tile
        icon={<TrendingUp className="h-4 w-4" />}
        label="Cumplimiento (7 días)"
        value={`${stats.complianceRate}%`}
        tone={stats.complianceRate >= 85 ? 'good' : stats.complianceRate >= 60 ? 'warn' : 'bad'}
        hint={
          stats.avgCloseHours !== null
            ? `Se cierran en ${stats.avgCloseHours} h de media`
            : 'Aún no hay histórico'
        }
      />
      <Tile
        icon={<Bot className="h-4 w-4" />}
        label="Creadas solas"
        value={`${autoShare}%`}
        tone="neutral"
        hint={`${stats.automated} automáticas · ${stats.routine} de rutina · ${stats.manual} a mano`}
      />

      {stats.perMember.length > 0 && (
        <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 sm:col-span-2 xl:col-span-4">
          <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            <Repeat className="h-3.5 w-3.5" />
            Carga por persona
          </h3>
          <ul className="flex flex-wrap gap-2">
            {stats.perMember
              .map((pm) => ({ pm, member: members.find((m) => m.userId === pm.userId) }))
              .filter((x) => x.member)
              .sort((a, b) => b.pm.overdue - a.pm.overdue || b.pm.open - a.pm.open)
              .map(({ pm, member }) => (
                <li
                  key={pm.userId}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white py-1 pl-1 pr-3"
                >
                  {member && <Avatar member={member} size="sm" ring={false} />}
                  <span className="text-xs font-medium text-zinc-700">{member?.name}</span>
                  <span className="text-[11px] tabular-nums text-zinc-500">{pm.open} abiertas</span>
                  {pm.overdue > 0 && (
                    <span className="rounded-full bg-red-50 px-1.5 text-[10px] font-semibold tabular-nums text-red-600">
                      {pm.overdue} vencidas
                    </span>
                  )}
                  {pm.doneThisWeek > 0 && (
                    <span className="rounded-full bg-emerald-50 px-1.5 text-[10px] font-semibold tabular-nums text-emerald-700">
                      {pm.doneThisWeek} ✓
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  hint: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
}) {
  const toneClass = {
    good: 'text-emerald-600',
    warn: 'text-amber-600',
    bad: 'text-red-600',
    neutral: 'text-zinc-900',
  }[tone];

  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        <span className={toneClass}>{icon}</span>
        {label}
      </div>
      <p className={cn('mt-1.5 text-2xl font-semibold tabular-nums tracking-tight', toneClass)}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-zinc-500">{hint}</p>
    </div>
  );
}
