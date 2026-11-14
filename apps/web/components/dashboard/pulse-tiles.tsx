import { AnimatedNumber, Reveal } from '@/components/ui/motion';
import { ProgressRing } from '@/components/ui/stat';
import { cn } from '@/lib/cn';
import type { AgendaPulse } from '@/lib/data/analytics/agenda-pulse';
import { MINUTES_PER, outOfTen, workdaysLabel } from '@/lib/data/analytics/value-model';
import {
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  CalendarCheck,
  Clock3,
  Coins,
  Moon,
} from 'lucide-react';
import type * as React from 'react';

/*
 * Las cuatro tarjetas de arriba del panel en una clínica con agenda propia:
 * citas de hoy, dinero recuperado, horas ahorradas y lo que hace el asistente.
 * Todo lo que se mueve es `transform`/`opacity` y se anima una sola vez al
 * entrar (nada en bucle): «reducir movimiento» lo apaga en globals.css.
 */

const CHIP = {
  grape: 'bg-brand-100 text-brand-600',
  mint: 'bg-emerald-100 text-emerald-600',
  sky: 'bg-teal-100 text-teal-700',
  honey: 'bg-amber-100 text-amber-600',
} as const;

function Tile({
  label,
  icon,
  tone,
  badge,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  tone: keyof typeof CHIP;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="stat"
      className="group relative flex h-full flex-col overflow-hidden rounded-[22px] border border-(--color-border) bg-white p-5 shadow-[var(--shadow-soft)] transition-shadow duration-500 hover:shadow-[var(--shadow-lifted)]"
    >
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-zinc-500">{label}</p>
          {badge}
        </div>
        <span
          className={cn(
            'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110',
            CHIP[tone],
          )}
        >
          {icon}
        </span>
      </div>
      <div className="relative mt-3 flex flex-1 flex-col">{children}</div>
    </div>
  );
}

function BigNumber({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'text-[31px] font-bold leading-none tracking-tight text-zinc-900 sm:text-[34px]',
        className,
      )}
    >
      {children}
    </span>
  );
}

function euros(cents: number): string {
  return `${Math.round(cents / 100).toLocaleString('es-ES', { useGrouping: 'always' as unknown as boolean })} €`;
}

function duration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  return `${h.toLocaleString('es-ES', { maximumFractionDigits: h < 10 ? 1 : 0 })} h`;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('es-ES')} ${n === 1 ? one : many}`;
}

/* ── 1. Citas de hoy ──────────────────────────────────────────────────── */

function TodayTile({ today }: { today: AgendaPulse['today'] }) {
  const pct = today.total > 0 ? (today.confirmed / today.total) * 100 : 0;
  return (
    <Tile label="Citas hoy" icon={<CalendarCheck className="h-4 w-4" />} tone="grape">
      <div className="flex items-center justify-between gap-3">
        <div>
          <BigNumber>
            <AnimatedNumber value={today.total} />
          </BigNumber>
          <p className="mt-1.5 text-[12px] text-zinc-500">
            {today.total === 0
              ? 'Hoy no hay citas'
              : today.nextTime
                ? `Siguiente a las ${today.nextTime}`
                : 'Ya no quedan más por hoy'}
          </p>
        </div>
        {today.total > 0 && (
          <ProgressRing
            value={pct}
            size={68}
            stroke={7}
            tone="mint"
            label={`${Math.round(pct)}%`}
          />
        )}
      </div>
      {today.total > 0 && (
        <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
          <span className="inline-flex animate-pop items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-700">
            {plural(today.confirmed, 'confirmada', 'confirmadas')}
          </span>
          {today.pending > 0 && (
            <span
              className="inline-flex animate-pop items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-semibold text-amber-700"
              style={{ animationDelay: '120ms' }}
            >
              {plural(today.pending, 'sin confirmar', 'sin confirmar')}
            </span>
          )}
        </div>
      )}
    </Tile>
  );
}

/* ── 2. Dinero recuperado ─────────────────────────────────────────────── */

function RecoveredTile({ recovered }: { recovered: AgendaPulse['recovered'] }) {
  const max = Math.max(...recovered.weekly, 1);
  const empty = recovered.totalCount === 0;
  return (
    <Tile label="Recuperado este mes" icon={<Coins className="h-4 w-4" />} tone="mint">
      <BigNumber className="text-emerald-700">
        <AnimatedNumber value={Math.round(recovered.monthCents / 100)} suffix=" €" grouping />
      </BigNumber>
      <p className="mt-1.5 text-[12px] text-zinc-500">
        {empty
          ? 'Cuando se cancele una cita, ofreceremos el hueco y aquí verás lo recuperado'
          : `${plural(recovered.monthCount, 'hueco cancelado', 'huecos cancelados')} que se volvieron a llenar`}
      </p>

      {!empty && (
        <>
          {/* Últimas 8 semanas; la actual, en color intenso. */}
          <div className="mt-auto flex h-14 items-end gap-1.5 pt-4" aria-hidden>
            {recovered.weekly.map((cents, i) => {
              const current = i === recovered.weekly.length - 1;
              return (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: semanas fijas por posición
                  key={i}
                  className={cn(
                    'flex-1 origin-bottom animate-grow-y rounded-t-md',
                    current
                      ? 'bg-[linear-gradient(180deg,#34d399,#059669)]'
                      : cents > 0
                        ? 'bg-emerald-200'
                        : 'bg-zinc-200/70',
                  )}
                  style={{
                    height: `${Math.max(8, (cents / max) * 100)}%`,
                    animationDelay: `${120 + i * 70}ms`,
                  }}
                />
              );
            })}
          </div>
          <p className="mt-2 text-[12px] text-zinc-500">
            <span className="font-semibold text-zinc-700">{euros(recovered.totalCents)}</span> desde
            que se usa la agenda · últimas 8 semanas
          </p>
        </>
      )}
    </Tile>
  );
}

/* ── 3. Horas ahorradas ───────────────────────────────────────────────── */

const SEGMENT: Record<string, string> = {
  reply: 'bg-teal-500',
  booking: 'bg-emerald-400',
  reminder: 'bg-sky-400',
  offer: 'bg-amber-400',
};

function SavingsTile({ savings }: { savings: AgendaPulse['savings'] }) {
  const hoursValue = savings.totalMinutes / 60;
  const parts = savings.parts.filter((p) => p.minutes > 0);
  const assumptions = `Estimado: ${MINUTES_PER.reply} min por respuesta, ${MINUTES_PER.booking} por cita dada, ${MINUTES_PER.reminder} por recordatorio y ${MINUTES_PER.offer} por oferta de hueco.`;
  return (
    <Tile
      label="Horas ahorradas este mes"
      icon={<Clock3 className="h-4 w-4" />}
      tone="sky"
      badge={
        <span
          title={assumptions}
          className="mt-1 inline-flex cursor-help rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500"
        >
          estimado
        </span>
      }
    >
      <BigNumber className="text-teal-800">
        <AnimatedNumber value={hoursValue} decimals={hoursValue < 10 ? 1 : 0} suffix=" h" />
      </BigNumber>
      <p className="mt-1.5 text-[12px] text-zinc-500">
        {savings.totalMinutes === 0
          ? 'Aquí verás el trabajo que hace la plataforma por ti'
          : workdaysLabel(savings.totalMinutes) || 'de trabajo de recepción'}
      </p>

      {parts.length > 0 && (
        <div className="mt-auto pt-4">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
            {parts.map((p, i) => (
              <span
                key={p.key}
                className={cn('h-full origin-left animate-grow-x', SEGMENT[p.key])}
                style={{
                  width: `${(p.minutes / savings.totalMinutes) * 100}%`,
                  animationDelay: `${150 + i * 160}ms`,
                }}
              />
            ))}
          </div>
          <ul className="mt-3 space-y-1">
            {parts.map((p) => (
              <li key={p.key} className="flex items-center gap-2 text-[12px]">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', SEGMENT[p.key])} />
                <span className="min-w-0 flex-1 truncate text-zinc-600">{p.label}</span>
                <span className="shrink-0 font-semibold tabular-nums text-zinc-800">
                  {duration(p.minutes)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Tile>
  );
}

/* ── 4. El asistente ──────────────────────────────────────────────────── */

function AssistantTile({ assistant }: { assistant: AgendaPulse['assistant'] }) {
  const delta = assistant.thisMonth - assistant.lastMonth;
  const dots = outOfTen(assistant.thisMonth, assistant.monthBookings);
  const offPct =
    assistant.replies > 0 ? Math.round((assistant.offHours / assistant.replies) * 100) : 0;
  return (
    <Tile label="Citas del asistente este mes" icon={<Bot className="h-4 w-4" />} tone="grape">
      <div className="flex items-baseline gap-2">
        <BigNumber>
          <AnimatedNumber value={assistant.thisMonth} />
        </BigNumber>
        {assistant.lastMonth > 0 && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[12px] font-bold',
              delta >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600',
            )}
            title={`${assistant.lastMonth} el mes pasado`}
          >
            {delta >= 0 ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {delta > 0 ? `+${delta}` : delta}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[12px] text-zinc-500">
        {assistant.replies > 0
          ? `${plural(assistant.replies, 'mensaje respondido', 'mensajes respondidos')} en ${plural(assistant.conversations, 'conversación', 'conversaciones')}`
          : 'Por WhatsApp y teléfono'}
      </p>

      <div className="mt-auto pt-4">
        {dots > 0 && (
          <>
            <div className="flex gap-1.5" aria-hidden>
              {Array.from({ length: 10 }, (_, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: diez puntos fijos
                  key={i}
                  className={cn(
                    'h-3 flex-1 animate-pop rounded-full',
                    i < dots ? 'bg-[linear-gradient(90deg,#37766a,#5fa896)]' : 'bg-zinc-200/80',
                  )}
                  style={{ animationDelay: `${100 + i * 55}ms` }}
                />
              ))}
            </div>
            <p className="mt-2 text-[12px] text-zinc-600">
              De cada 10 citas,{' '}
              <span className="font-semibold text-zinc-800">
                {dots} {dots === 1 ? 'la dio' : 'las dio'} el asistente
              </span>
            </p>
          </>
        )}
        {offPct > 0 && (
          <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[12px] font-medium text-indigo-700">
            <Moon className="h-3.5 w-3.5" />
            {offPct} % de noche o en fin de semana
          </span>
        )}
      </div>
    </Tile>
  );
}

const STAGGER = ['[--i:0]', '[--i:1]', '[--i:2]', '[--i:3]'];

export function PulseTiles({ pulse }: { pulse: AgendaPulse }) {
  const tiles = [
    <TodayTile key="today" today={pulse.today} />,
    <RecoveredTile key="recovered" recovered={pulse.recovered} />,
    <SavingsTile key="savings" savings={pulse.savings} />,
    <AssistantTile key="assistant" assistant={pulse.assistant} />,
  ];
  return (
    <div className="rise-stagger mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
      {tiles.map((tile, i) => (
        <Reveal key={tile.key} className={cn('h-full', STAGGER[i])}>
          {tile}
        </Reveal>
      ))}
    </div>
  );
}
