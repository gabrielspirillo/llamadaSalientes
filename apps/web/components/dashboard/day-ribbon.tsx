'use client';

import { cn } from '@/lib/cn';
import type { TodayBoard } from '@/lib/data/analytics/today-board';
import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * La jornada a escala: cada cita es un tramo del ancho de su duración sobre
 * la rejilla de horas. Lo hecho se llena de menta, la sesión en curso se va
 * rellenando por dentro y el «ahora» avanza solo cada medio minuto. Todo con
 * transform/opacity; la entrada se anima una vez.
 */
export function DayRibbon({
  items,
  nowMinute: serverNow,
  nextId,
  demo,
}: {
  items: TodayBoard['items'];
  nowMinute: number;
  nextId?: string;
  demo?: boolean;
}) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const t0 = Date.now();
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      setNow(serverNow + Math.floor((Date.now() - t0) / 60_000));
    };
    const iv = setInterval(tick, 30_000);
    return () => clearInterval(iv);
  }, [serverNow]);

  const first = Math.min(...items.map((i) => i.minute));
  const last = Math.max(...items.map((i) => i.minute + i.minutes));
  const start = Math.floor(first / 60) * 60;
  const end = Math.max(start + 120, Math.ceil(last / 60) * 60);
  const span = end - start;
  const pct = (m: number) => Math.max(0, Math.min(100, ((m - start) / span) * 100));
  const nowPct = pct(now);
  const nowVisible = now >= start && now <= end;
  const step = span > 8 * 60 ? 120 : 60;
  const hours: number[] = [];
  for (let h = start; h <= end; h += step) hours.push(h);

  return (
    <div className="relative mt-5 select-none" aria-label="Línea del día">
      <div className="group/rib relative h-[54px]">
        {/* Rejilla de horas */}
        {hours.map((h) => (
          <span
            key={h}
            aria-hidden
            className="ribbon-fade absolute top-[22px] bottom-[2px] w-px bg-white/[0.07]"
            style={{ left: `${pct(h)}%` }}
          />
        ))}

        {/* Pista */}
        <div className="absolute inset-x-0 top-[30px] h-3 rounded-full bg-white/[0.06] shadow-[inset_0_1px_1px_rgba(0,0,0,0.25),0_1px_0_rgba(255,255,255,0.05)]" />

        {/* Lo que ya pasó del día: un velo menta que llega hasta ahora */}
        {nowVisible && (
          <div
            aria-hidden
            className="ribbon-wash pointer-events-none absolute left-0 top-[22px] h-7 rounded-l-full bg-[linear-gradient(90deg,rgba(110,231,183,0)_0%,rgba(110,231,183,0.16)_100%)]"
            style={{ width: `${nowPct}%` }}
          />
        )}

        {/* Una pieza por cita, a escala */}
        {items.map((it, i) => {
          const s = it.minute;
          const e = it.minute + it.minutes;
          const noShow = it.status === 'NO_SHOW';
          const done = it.status === 'COMPLETED' || e <= now;
          const live = !noShow && it.status !== 'COMPLETED' && s <= now && now < e;
          const isNext = it.id === nextId && !live;
          const progress = live ? ((now - s) / it.minutes) * 100 : 0;
          return (
            <Link
              key={it.id}
              href={demo ? '/dashboard?demo=1' : `/dashboard/agenda?cita=${it.id}`}
              className="group absolute top-[30px] z-10 h-3 hover:z-30"
              style={{
                left: `calc(${pct(s)}% + 1.5px)`,
                width: `calc(${pct(e) - pct(s)}% - 3px)`,
              }}
            >
              <span
                className={cn(
                  'ribbon-block relative block h-full overflow-hidden rounded-full transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-y-[1.6]',
                  live
                    ? 'bg-white/25 shadow-[0_0_0_1px_rgba(255,255,255,0.6),0_0_18px_2px_rgba(167,243,208,0.55)]'
                    : noShow
                      ? 'bg-rose-300/55'
                      : done
                        ? 'bg-[linear-gradient(90deg,#5fb597,#a7f3d0)]'
                        : isNext
                          ? 'bg-white/30 shadow-[0_0_0_1.5px_rgba(167,243,208,0.95)]'
                          : it.firstVisit
                            ? 'bg-amber-200/15 shadow-[inset_0_0_0_1px_rgba(253,230,138,0.55)]'
                            : 'bg-white/[0.12] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]',
                )}
                style={{ animationDelay: `${120 + i * 55}ms` }}
              >
                {live && (
                  <>
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-white transition-[width] duration-1000"
                      style={{ width: `${progress}%` }}
                    />
                    <span aria-hidden className="ribbon-sheen absolute inset-y-0 w-1/2" />
                  </>
                )}
              </span>
              {/* Etiqueta al pasar por encima */}
              <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-lg bg-[#0b1714]/90 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg ring-1 ring-white/10 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
                <span className="tabular-nums text-emerald-200">{it.time}</span> ·{' '}
                {it.patientName.split(' ')[0]}
              </span>
            </Link>
          );
        })}

        {/* Ahora */}
        {nowVisible && (
          <div
            aria-hidden
            className="day-now pointer-events-none absolute inset-y-0 left-0 z-20 w-full transition-transform duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ transform: `translateX(${nowPct}%)` }}
          >
            <span
              className={cn(
                // Al pasar por una cita su etiqueta ocupa este sitio: la del «ahora» se aparta.
                'absolute top-0 flex items-center gap-1.5 rounded-full bg-white px-2 py-[3px] text-[11px] font-semibold tabular-nums text-[#14211d] shadow-[0_6px_16px_-6px_rgba(0,0,0,0.6)] transition-opacity duration-200 group-has-[a:hover]/rib:opacity-0',
                nowPct < 6
                  ? 'left-0 -translate-x-1'
                  : nowPct > 94
                    ? 'right-full translate-x-1'
                    : '-translate-x-1/2',
              )}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70 [animation-iteration-count:3]" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              {hhmm(now)}
            </span>
            <span className="absolute top-[22px] h-7 w-[2px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_10px_2px_rgba(167,243,208,0.75)]" />
          </div>
        )}
      </div>

      {/* Horas */}
      <div className="relative mt-1.5 h-4 text-[10.5px] font-medium tabular-nums text-white/40">
        {hours.map((h, i) => (
          <span
            key={h}
            className={cn(
              'ribbon-fade absolute',
              i === 0 ? '' : i === hours.length - 1 ? '-translate-x-full' : '-translate-x-1/2',
              // En móvil, una hora sí y otra no: juntas no caben.
              hideOnMobile(i, hours.length - 1) && 'max-sm:hidden',
            )}
            style={{ left: `${pct(h)}%` }}
          >
            {String(Math.floor(h / 60)).padStart(2, '0')}:00
          </span>
        ))}
      </div>
    </div>
  );
}

function hideOnMobile(i: number, last: number): boolean {
  if (i === 0 || i === last) return false;
  if (last % 2 === 1 && i === last - 1) return true;
  return i % 2 === 1;
}

function hhmm(minute: number): string {
  const m = Math.max(0, Math.min(24 * 60, minute));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
