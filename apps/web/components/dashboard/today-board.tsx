import { HeroLines } from '@/components/dashboard/hero-lines';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AnimatedNumber } from '@/components/ui/motion';
import { STATUS_LABELS } from '@/lib/agenda/shared';
import { cn } from '@/lib/cn';
import { freeMinutes } from '@/lib/data/analytics/month-model';
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
      label: board.attention.handoffs === 1 ? 'espera a una persona' : 'esperan a una persona',
      hint: 'en WhatsApp',
      icon: <MessageCircle className="h-4 w-4" />,
      href: '/dashboard/whatsapp',
      tone: 'text-brand-700 bg-brand-50',
    },
    {
      key: 'tasks',
      n: board.attention.overdueTasks,
      label: board.attention.overdueTasks === 1 ? 'tarea vencida' : 'tareas vencidas',
      hint: 'del equipo',
      icon: <ClipboardList className="h-4 w-4" />,
      href: '/dashboard/tasks',
      tone: 'text-rose-700 bg-rose-50',
    },
    {
      key: 'offers',
      n: board.attention.pendingOffers,
      label: board.attention.pendingOffers === 1 ? 'hueco ofrecido' : 'huecos ofrecidos',
      hint: 'esperando respuesta',
      icon: <Phone className="h-4 w-4" />,
      href: '/dashboard/agenda',
      tone: 'text-sky-700 bg-sky-50',
    },
  ];
  const needs = attention.reduce((a, b) => a + b.n, 0);

  return (
    <Card className="mb-6 overflow-hidden border-0 p-0 shadow-[var(--shadow-float)]">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Hoy: bloque oscuro, el mismo lenguaje que el resumen del caso */}
        <div
          data-slot="hero"
          className="relative min-w-0 overflow-hidden bg-[linear-gradient(140deg,#14211d_0%,#1d3a33_55%,#2b5a4d_100%)] p-5 text-white sm:p-6"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-emerald-300/20 blur-3xl animate-drift"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-28 left-1/3 h-56 w-56 rounded-full bg-teal-200/10 blur-3xl animate-float-slow"
          />
          <HeroLines />
          <div className="relative flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-200/90">
                Hoy
              </p>
              <h2 className="mt-1 text-[24px] font-extrabold tracking-tight text-white">
                {dateLabel(board.dateKey)}
              </h2>
              <p className="mt-1 text-[14px] text-emerald-50/75">
                {board.items.length === 0
                  ? 'Hoy no hay citas. Así viene tu semana:'
                  : `${board.items.length} ${board.items.length === 1 ? 'cita' : 'citas'} · ${done} ${done === 1 ? 'atendida' : 'atendidas'}${
                      next
                        ? ` · siguiente a las ${next.time}, ${next.patientName.split(' ')[0]}`
                        : ''
                    }`}
              </p>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="glass" size="sm" className="press">
                <Link href="/dashboard/agenda">
                  Abrir agenda <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <Button
                asChild
                size="sm"
                className="press bg-white text-[#14211d] shadow-[0_10px_24px_-10px_rgba(0,0,0,0.5)] hover:bg-emerald-50"
              >
                <Link href="/dashboard/agenda?nueva=1">
                  <CalendarPlus className="h-4 w-4" /> Nueva cita
                </Link>
              </Button>
            </div>
          </div>

          {board.items.length === 0 && <WeekStrip board={board} demo={demo} />}

          {board.items.length > 0 && (
            <>
              <DayLine items={board.items} nowMinute={board.nowMinute} nextId={next?.id} />
              {/* El carril tiene aire arriba y abajo: la tarjeta al elevarse y su
                  sombra no se recortan con el scroll horizontal. */}
              {/* El carril llega hasta el borde del bloque (sin el corte seco en
                  el padding) y se desvanece a la derecha: se lee que sigue. */}
              <ol
                className="rise-stagger relative -mx-5 mt-2 flex gap-2.5 overflow-x-auto pt-3 pb-4 pl-5 pr-14 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.25)_transparent] sm:-mx-6 sm:pl-6"
                style={{
                  maskImage:
                    'linear-gradient(90deg, transparent 0, #000 14px, #000 calc(100% - 56px), transparent)',
                }}
              >
                {board.items.map((it, i) => {
                  const past = ['COMPLETED', 'NO_SHOW'].includes(it.status);
                  const isNext = next?.id === it.id;
                  return (
                    <li key={it.id} style={{ ['--i' as string]: i }} className="shrink-0">
                      <Link
                        data-slot="hero-slot"
                        data-next={isNext ? '' : undefined}
                        href={demo ? '/dashboard?demo=1' : `/dashboard/agenda?cita=${it.id}`}
                        className={cn(
                          'group block w-[156px] rounded-[16px] p-3.5 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                          'hover:shadow-[0_18px_34px_-14px_rgba(0,0,0,0.55)]',
                          isNext
                            ? 'bg-white text-[#14211d] shadow-[0_14px_30px_-12px_rgba(0,0,0,0.6),0_0_0_2px_rgba(110,231,183,0.9)]'
                            : past
                              ? 'bg-white/8 text-white/55 ring-1 ring-white/10'
                              : 'bg-white/12 text-white ring-1 ring-white/15 backdrop-blur-sm hover:bg-white/18',
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[16px] font-extrabold tabular-nums tracking-tight">
                            {it.time}
                          </span>
                          {/* «Siguiente» va en la fila de la hora: debajo hacía la
                              tarjeta más alta y el carril dejaba un hueco vacío. */}
                          {isNext ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                              Siguiente
                            </span>
                          ) : (
                            <span
                              className={cn(
                                'h-2.5 w-2.5 rounded-full ring-2 ring-white/20',
                                STATUS_DOT[it.status] ?? 'bg-zinc-300',
                              )}
                              title={STATUS_LABELS[it.status]}
                            />
                          )}
                        </div>
                        <p
                          className={cn(
                            'mt-2 truncate text-[13px] font-semibold',
                            isNext ? 'text-[#14211d]' : past ? 'text-white/70' : 'text-white',
                          )}
                        >
                          {it.patientName}
                        </p>
                        <p
                          className={cn(
                            'truncate text-[11px] uppercase tracking-wide',
                            isNext ? 'text-emerald-700' : 'text-white/50',
                            it.firstVisit && (isNext ? 'text-amber-600' : 'text-amber-200'),
                          )}
                        >
                          {it.firstVisit
                            ? '1ª visita'
                            : (it.treatmentName ?? STATUS_LABELS[it.status])}
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>

        {/* Requiere atención */}
        <div
          data-slot="hero-side"
          className="border-t border-(--color-border-subtle) bg-white p-5 lg:border-t-0 lg:border-l"
        >
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              Requiere atención
            </p>
            {needs === 0 && <Badge tone="success">Todo al día</Badge>}
          </div>
          <ul className="rise-stagger mt-3 space-y-1">
            {attention.map((a, i) => (
              <li key={a.key} style={{ ['--i' as string]: i }}>
                <Link
                  href={demo ? '/dashboard?demo=1' : a.href}
                  className={cn(
                    'group flex items-center gap-3 rounded-[14px] px-2.5 py-2.5 transition-all duration-300 hover:bg-zinc-50 hover:pl-3.5',
                    a.n === 0 && 'opacity-45',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-6',
                      a.tone,
                    )}
                  >
                    {a.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <AnimatedNumber
                        value={a.n}
                        className="text-[20px] font-extrabold tabular-nums tracking-tight text-zinc-900"
                      />
                      <span className="text-[13.5px] font-semibold text-zinc-700">{a.label}</span>
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

function hhmm(minute: number): string {
  const m = Math.max(0, Math.min(24 * 60, minute));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * La jornada de un vistazo: una línea de la primera a la última hora, una
 * marca por cita (llena = ya pasó) y el «ahora» que se desliza hasta su sitio.
 * Sólo transform/opacity; el desliz ocurre una vez al entrar.
 */
function DayLine({
  items,
  nowMinute,
  nextId,
}: {
  items: TodayBoard['items'];
  nowMinute: number;
  nextId?: string;
}) {
  const first = Math.min(...items.map((i) => i.minute));
  const last = Math.max(...items.map((i) => i.minute));
  const start = Math.floor(first / 60) * 60;
  const end = Math.max(start + 60, Math.ceil((last + 45) / 60) * 60);
  const pos = (m: number) => Math.max(0, Math.min(100, ((m - start) / (end - start)) * 100));
  const nowPct = pos(nowMinute);
  const done = items.filter((i) => ['COMPLETED', 'NO_SHOW'].includes(i.status)).length;
  return (
    <div className="relative mt-5" title={`${done} de ${items.length} atendidas`}>
      <div className="relative h-6">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/12">
          <div
            className="h-full origin-left animate-grow-x rounded-full bg-[linear-gradient(90deg,rgba(107,194,164,0.35),#a7f3d0)]"
            style={{ width: `${nowPct}%`, animationDuration: '1.1s' }}
          />
        </div>
        {items.map((it, i) => {
          const past = it.minute + 30 < nowMinute || ['COMPLETED', 'NO_SHOW'].includes(it.status);
          const isNext = it.id === nextId;
          return (
            <span
              key={it.id}
              title={`${it.time} · ${it.patientName}`}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${pos(it.minute)}%` }}
            >
              <span
                className={cn(
                  'block animate-pop rounded-full',
                  isNext
                    ? 'h-3 w-3 bg-white shadow-[0_0_0_3px_rgba(110,231,183,0.55)]'
                    : past
                      ? it.status === 'NO_SHOW'
                        ? 'h-2 w-2 bg-rose-300'
                        : 'h-2 w-2 bg-[#a7f3d0]'
                      : 'h-2 w-2 bg-[#14211d] ring-[1.5px] ring-white/70',
                )}
                style={{ animationDelay: `${300 + i * 60}ms` }}
              />
            </span>
          );
        })}
        {nowMinute >= start && nowMinute <= end && (
          <span
            aria-hidden
            className="day-now absolute inset-y-0 left-0 w-full"
            style={{ transform: `translateX(${nowPct}%)` }}
          >
            <span className="absolute left-0 top-1/2 block h-5 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_10px_2px_rgba(167,243,208,0.8)]" />
          </span>
        )}
      </div>
      <div className="mt-0.5 flex justify-between text-[11px] font-medium tabular-nums text-white/45">
        <span>{hhmm(start)}</span>
        {nowMinute >= start && nowMinute <= end && (
          <span className="text-emerald-200/90">Ahora {hhmm(nowMinute)}</span>
        )}
        <span>{hhmm(end)}</span>
      </div>
    </div>
  );
}

function weekdayName(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('es-ES', {
    weekday: 'long',
    timeZone: 'UTC',
  });
}

function hoursLabel(minutes: number): string {
  const h = Math.round((minutes / 60) * 2) / 2;
  return `${h.toLocaleString('es-ES')} h`;
}

/**
 * Un día sin citas, el bloque «Hoy» enseña la semana que viene: una cápsula
 * por día que se llena según lo reservado sobre su horario. Cada día abre la
 * agenda en esa fecha.
 */
function WeekStrip({ board, demo }: { board: TodayBoard; demo?: boolean }) {
  const week = board.week;
  if (week.length === 0) return null;
  const next = week.find((d) => d.count > 0);
  const free = freeMinutes(week);
  const total = week.reduce((a, d) => a + d.count, 0);
  const firsts = week.reduce((a, d) => a + d.firstVisits, 0);
  return (
    <div className="relative mt-5">
      <ol className="grid grid-cols-7 gap-1.5 sm:gap-3">
        {week.map((d, i) => {
          const fill = d.closed
            ? 0
            : d.shiftMinutes > 0
              ? Math.min(1, d.bookedMinutes / d.shiftMinutes)
              : d.count > 0
                ? 1
                : 0;
          return (
            <li key={d.dayKey}>
              <Link
                href={demo ? '/dashboard?demo=1' : `/dashboard/agenda?date=${d.dayKey}`}
                title={
                  d.closed
                    ? 'Cerrado'
                    : `${d.count} ${d.count === 1 ? 'cita' : 'citas'}${d.firstTime ? ` · desde las ${d.firstTime}` : ''}`
                }
                className="group flex flex-col items-center gap-2 rounded-[16px] py-2 transition-colors duration-300 hover:bg-white/8"
              >
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-100/60">
                  {d.letter}
                </span>
                <span className="text-[15px] font-extrabold tabular-nums text-white sm:text-[17px]">
                  {d.dayNumber}
                </span>
                <span
                  className={cn(
                    'relative h-20 w-3.5 overflow-hidden rounded-full sm:h-24 sm:w-5',
                    d.closed ? 'border border-dashed border-white/15' : 'bg-white/10',
                  )}
                  aria-hidden
                >
                  {fill > 0 && (
                    <span
                      className="absolute inset-x-0 bottom-0 origin-bottom animate-grow-y rounded-full bg-[linear-gradient(180deg,#a7f3d0,#34d399)] transition-[filter] duration-300 group-hover:brightness-110"
                      style={{
                        height: `${Math.max(10, fill * 100)}%`,
                        animationDelay: `${150 + i * 80}ms`,
                      }}
                    />
                  )}
                </span>
                <span
                  className={cn(
                    'text-[13px] font-bold tabular-nums',
                    d.closed ? 'text-white/30' : 'text-white',
                  )}
                >
                  {d.closed ? '—' : d.count}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-emerald-50/80">
        {next ? (
          <span>
            El <span className="font-semibold text-white">{weekdayName(next.dayKey)}</span> empiezas
            a las <span className="font-semibold text-white tabular-nums">{next.firstTime}</span>
          </span>
        ) : (
          <span>Todavía no hay citas para los próximos 7 días</span>
        )}
        {total > 0 && (
          <span className="tabular-nums">
            {total} {total === 1 ? 'cita' : 'citas'} en la semana
            {firsts > 0
              ? ` · ${firsts} ${firsts === 1 ? 'primera visita' : 'primeras visitas'}`
              : ''}
          </span>
        )}
        {free >= 30 && (
          <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-0.5 text-[12px] font-semibold text-emerald-100">
            {hoursLabel(free)} libres para llenar
          </span>
        )}
      </div>
    </div>
  );
}
