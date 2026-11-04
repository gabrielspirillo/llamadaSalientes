'use client';

import type { NoShowSeriesPoint, TopTreatment } from '@/lib/data/analytics/global';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { axisProps, chartAnim, chartPalette, chartSequence, tooltipStyle } from './chart-theme';

function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="flex h-56 flex-col items-center justify-center gap-2 text-sm text-zinc-500">
      <span className="inline-flex h-10 w-10 animate-float items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#effaf5,#ddf3ea)]" />
      {label}
    </div>
  );
}

export function NoShowTrendChart({ data }: { data: NoShowSeriesPoint[] }) {
  if (data.length === 0) return <ChartEmpty label="Sin datos aún" />;

  const chartData = data.map((p) => ({
    label: new Date(p.weekStart).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
    }),
    value: Number((p.rate * 100).toFixed(1)),
  }));
  const max = Math.max(5, ...chartData.map((d) => d.value));

  return (
    <ResponsiveContainer width="100%" height={224}>
      <AreaChart data={chartData} margin={{ top: 14, right: 8, left: -6, bottom: 0 }}>
        <defs>
          <linearGradient id="noShowFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={chartPalette.rose} stopOpacity={0.22} />
            <stop offset="100%" stopColor={chartPalette.rose} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={28} />
        <YAxis
          {...axisProps}
          width={40}
          domain={[0, Math.ceil(max / 5) * 5]}
          ticks={[0, Math.ceil(max / 5) * 5]}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ stroke: '#e4e7e6', strokeWidth: 1 }}
          formatter={(v) => [`${v}%`, 'No-show']}
        />
        <Area
          type="natural"
          dataKey="value"
          stroke={chartPalette.rose}
          strokeWidth={2.25}
          fill="url(#noShowFill)"
          dot={false}
          activeDot={{ r: 5, fill: chartPalette.rose, strokeWidth: 3, stroke: '#fff' }}
          {...chartAnim}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface WeeklyPoint {
  label: string;
  count: number;
  current: boolean;
}

/** Citas por semana, ocho semanas: barras redondeadas, la actual en marca. */
export function WeeklyAppointmentsChart({ data }: { data: WeeklyPoint[] }) {
  if (data.every((d) => d.count === 0)) return <ChartEmpty label="Sin citas aún" />;
  return (
    <ResponsiveContainer width="100%" height={224}>
      <BarChart
        data={data}
        margin={{ top: 14, right: 8, left: -14, bottom: 0 }}
        barCategoryGap="28%"
      >
        <XAxis dataKey="label" {...axisProps} interval={0} minTickGap={4} fontSize={10.5} />
        <YAxis {...axisProps} width={40} allowDecimals={false} tickCount={3} />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: 'rgba(55,118,106,0.06)', radius: 10 }}
          formatter={(v) => [`${v}`, 'Citas']}
        />
        <Bar dataKey="count" radius={[10, 10, 10, 10]} maxBarSize={34} {...chartAnim}>
          {data.map((d) => (
            <Cell
              key={d.label}
              fill={d.current ? chartPalette.brand : '#d9ebe4'}
              fillOpacity={d.current ? 1 : 0.95}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TopTreatmentsChart({ data }: { data: TopTreatment[] }) {
  if (data.length === 0) return <ChartEmpty label="Sin citas aún" />;

  const chartData = data.map((t) => ({ name: t.name, value: t.count }));
  const total = chartData.reduce((acc, d) => acc + d.value, 0);

  return (
    <div>
      <div className="relative">
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Tooltip contentStyle={tooltipStyle} wrapperStyle={{ zIndex: 50 }} />
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius={58}
              outerRadius={88}
              paddingAngle={3}
              cornerRadius={6}
              stroke="none"
              {...chartAnim}
            >
              {chartData.map((d, i) => (
                <Cell key={d.name} fill={chartSequence[i % chartSequence.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[28px] font-bold tabular-nums leading-none text-zinc-900">
            {total}
          </span>
          <span className="mt-1 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            Citas
          </span>
        </div>
      </div>

      {/* Leyenda propia: más legible que la de recharts y con el mismo lenguaje */}
      <ul className="mt-3 space-y-1.5">
        {chartData.slice(0, 5).map((d, i) => (
          <li key={d.name} className="flex items-center gap-2 text-[13px]">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: chartSequence[i % chartSequence.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-zinc-600">{d.name}</span>
            <span className="font-bold tabular-nums text-zinc-800">{d.value}</span>
            <span className="w-9 text-right text-zinc-500 tabular-nums">
              {Math.round((d.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
