'use client';

import type { OutboundDailyPoint } from '@/lib/data/analytics/outbound';
import type {
  ConversationStatusBreakdown,
  MessagesByHourPoint,
} from '@/lib/data/analytics/whatsapp';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  axisProps,
  chartAnim,
  chartPalette,
  gridProps,
  tooltipCursor,
  tooltipStyle,
} from './chart-theme';

const STATUS_COLORS = {
  Activas: chartPalette.emerald,
  'Con humano': chartPalette.amber,
  Cerradas: chartPalette.lilac,
} as const;

/** Estado vacío común a los tres gráficos del módulo. */
function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="flex h-56 flex-col items-center justify-center gap-2 text-sm text-zinc-400">
      <span className="inline-flex h-10 w-10 animate-float items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#effaf5,#fdf0f7)]" />
      {label}
    </div>
  );
}

export function OutboundTrendChart({ data }: { data: OutboundDailyPoint[] }) {
  if (data.length === 0) {
    return <ChartEmpty label="Sin actividad reciente" />;
  }
  const chartData = data.map((d) => ({
    label: new Date(d.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }),
    Completadas: d.ended,
    'Sin contactar': Math.max(0, d.attempted - d.ended - d.failed),
    Fallidas: d.failed,
  }));

  return (
    <ResponsiveContainer width="100%" height={224}>
      <BarChart
        data={chartData}
        margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
        barCategoryGap="20%"
      >
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} width={32} />
        <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, paddingTop: 10, fontWeight: 500 }}
        />
        <Bar dataKey="Completadas" stackId="a" fill={chartPalette.emerald} {...chartAnim} />
        <Bar dataKey="Sin contactar" stackId="a" fill="#ded9ee" {...chartAnim} />
        <Bar
          dataKey="Fallidas"
          stackId="a"
          fill={chartPalette.rose}
          radius={[6, 6, 0, 0]}
          {...chartAnim}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MessagesByHourChart({ data }: { data: MessagesByHourPoint[] }) {
  const hasData = data.some((d) => d.inbound + d.outbound > 0);
  if (!hasData) {
    return <ChartEmpty label="Sin mensajes en las últimas 24h" />;
  }
  const chartData = data.map((d) => ({
    label: `${d.hour.toString().padStart(2, '0')}:00`,
    Entrantes: d.inbound,
    Salientes: d.outbound,
  }));

  return (
    <ResponsiveContainer width="100%" height={224}>
      <BarChart
        data={chartData}
        margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
        barCategoryGap="20%"
      >
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="label" {...axisProps} interval={2} />
        <YAxis {...axisProps} width={32} />
        <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, paddingTop: 10, fontWeight: 500 }}
        />
        <Bar dataKey="Entrantes" stackId="m" fill={chartPalette.violet} {...chartAnim} />
        <Bar
          dataKey="Salientes"
          stackId="m"
          fill={chartPalette.sky}
          radius={[6, 6, 0, 0]}
          {...chartAnim}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ConversationStatusChart({ data }: { data: ConversationStatusBreakdown }) {
  const total = data.active + data.handoff + data.closed;
  if (total === 0) {
    return <ChartEmpty label="Sin conversaciones" />;
  }
  const chartData = [
    { name: 'Activas', value: data.active },
    { name: 'Con humano', value: data.handoff },
    { name: 'Cerradas', value: data.closed },
  ].filter((d) => d.value > 0);

  return (
    <div>
      <div className="relative" style={{ height: 224 }}>
        <ResponsiveContainer width="100%" height={224}>
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
              {chartData.map((d) => (
                <Cell key={d.name} fill={STATUS_COLORS[d.name as keyof typeof STATUS_COLORS]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[26px] font-bold leading-none tabular-nums text-zinc-900">
            {total}
          </span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
            Total
          </span>
        </div>
      </div>
      <ul className="mt-4 space-y-1.5 text-xs">
        {chartData.map((d) => (
          <li key={d.name} className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-zinc-600">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[d.name as keyof typeof STATUS_COLORS] }}
              />
              {d.name}
            </span>
            <span className="font-bold tabular-nums text-zinc-800">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
