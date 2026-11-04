import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AnimatedNumber } from '@/components/ui/motion';
import { STATUS_LABELS } from '@/lib/agenda/shared';
import { cn } from '@/lib/cn';
import type { TodayBoard } from '@/lib/data/analytics/today-board';
import {
  ArrowRight,
  CalendarPlus,
  ClipboardList,
  MessageCircle,
  Phone,
  ShieldQuestion,
} from 'lucide-react';
import Link from 'next/link';

/**
 * El día en una línea: cada cita como un punto en el tiempo con su estado, y
 * al lado lo que espera a una persona. Es lo primero que se mira al abrir el
 * panel, así que no hay más que eso.
 */

const STATUS_DOT: Record<string, string> = {
  SCHEDULED: 'bg-[#3d8b8b]',
  CONFIRMED: 'bg-emerald-500',
  ARRIVED: 'bg-indigo-500',
  IN_PROGRESS: 'bg-violet-500',
  COMPLETED: 'bg-zinc-300',
  NO_SHOW: 'bg-rose-500',
  CANCELLED: 'bg-zinc-200',
};

function dateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const s = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function TodayBoardCard({ board, demo }: { board: TodayBoard; demo?: boolean }) {
  const done = board.items.filter((i) => ['COMPLETED', 'NO_SHOW'].includes(i.status)).length;
  const next = board.items.find(
    (i) => i.minute >= board.nowMinute - 5 && !['COMPLETED', 'NO_SHOW'].includes(i.status),
  );
  const attention = [
    {
      key: 'unconfirmed',
      n: board.attention.unconfirmed,
      label: 'sin confirmar',
      hint: 'hoy y mañana',
      icon: <ShieldQuestion className="h-4 w-4" />,
      href: '/dashboard/agenda',
      tone: 'text-amber-700 bg-amber-50',
    },
    {
      key: 'handoffs',
      n: board.attention.handoffs,
      label: 'esperan a una persona',
      hint: 'en WhatsApp',
      icon: <MessageCircle className="h-4 w-4" />,
      href: '/dashboard/whatsapp',
      tone: 'text-brand-700 bg-brand-50',
    },
    {
      key: 'tasks',
      n: board.attention.overdueTasks,
      label: 'tareas vencidas',
      hint: 'del equipo',
      icon: <ClipboardList className="h-4 w-4" />,
      href: '/dashboard/tasks',
      tone: 'text-rose-700 bg-rose-50',
    },
    {
      key: 'offers',
      n: board.attention.pendingOffers,
      label: 'huecos ofrecidos',
      hint: 'esperando respuesta',
      icon: <Phone className="h-4 w-4" />,
      href: '/dashboard/agenda',
      tone: 'text-sky-700 bg-sky-50',
    },
  ];
  const needs = attention.reduce((a, b) => a + b.n, 0);

  return (
    <Card className="mb-6 overflow-hidden p-0">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Hoy */}
        <div className="min-w-0 p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Hoy</p>
              <h2 className="mt-1 text-[22px] font-extrabold tracking-tight text-zinc-900">
                {dateLabel(board.dateKey)}
              </h2>
              <p className="mt-1 text-[14px] text-zinc-500">
                {board.items.length === 0
                  ? 'Sin citas hoy.'
                  : `${board.items.length} ${board.items.length === 1 ? 'cita' : 'citas'} · ${done} ${done === 1 ? 'atendida' : 'atendidas'}${
                      next
                        ? ` · siguiente a las ${next.time}, ${next.patientName.split(' ')[0]}`
                        : ''
                    }`}
              </p>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="soft" size="sm" className="press">
                <Link href="/dashboard/agenda">
                  Abrir agenda <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <Button asChild size="sm" className="press">
                <Link href="/dashboard/agenda?nueva=1">
                  <CalendarPlus className="h-4 w-4" /> Nueva cita
                </Link>
              </Button>
            </div>
          </div>

          {board.items.length > 0 && (
            <ol className="rise-stagger mt-5 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:thin]">
              {board.items.map((it, i) => {
                const past = ['COMPLETED', 'NO_SHOW'].includes(it.status);
                const isNext = next?.id === it.id;
                return (
                  <li key={it.id} style={{ ['--i' as string]: i }} className="shrink-0">
                    <Link
                      href={demo ? '/dashboard?demo=1' : `/dashboard/agenda?cita=${it.id}`}
                      className={cn(
                        'group block w-[150px] rounded-[16px] border p-3 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lifted)]',
                        isNext
                          ? 'border-brand-300 bg-brand-50/60 ring-4 ring-brand-500/10'
                          : 'border-(--color-border) bg-white',
                        past && 'opacity-60',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[15px] font-bold tabular-nums tracking-tight text-zinc-900">
                          {it.time}
                        </span>
                        <span
                          className={cn(
                            'h-2.5 w-2.5 rounded-full',
                            STATUS_DOT[it.status] ?? 'bg-zinc-300',
                          )}
                          title={STATUS_LABELS[it.status]}
                        />
                      </div>
                      <p className="mt-1.5 truncate text-[13px] font-semibold text-zinc-800">
                        {it.patientName}
                      </p>
                      <p className="truncate text-[11.5px] text-zinc-500">
                        {it.firstVisit
                          ? '1ª visita'
                          : (it.treatmentName ?? STATUS_LABELS[it.status])}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {/* Requiere atención */}
        <div className="border-t border-(--color-border-subtle) bg-[linear-gradient(180deg,#fafbfb,#f5f7f6)] p-5 lg:border-t-0 lg:border-l">
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              Requiere atención
            </p>
            {needs === 0 && <Badge tone="success">Todo al día</Badge>}
          </div>
          <ul className="rise-stagger mt-3 space-y-1.5">
            {attention.map((a, i) => (
              <li key={a.key} style={{ ['--i' as string]: i }}>
                <Link
                  href={demo ? '/dashboard?demo=1' : a.href}
                  className={cn(
                    'group flex items-center gap-3 rounded-[14px] px-3 py-2.5 transition-colors hover:bg-white',
                    a.n === 0 && 'opacity-55',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-6',
                      a.tone,
                    )}
                  >
                    {a.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-zinc-800">
                      <AnimatedNumber value={a.n} className="tabular-nums" /> {a.label}
                    </span>
                    <span className="block text-[12px] text-zinc-500">{a.hint}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-zinc-300 transition-transform duration-300 group-hover:translate-x-1 group-hover:text-zinc-500" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
