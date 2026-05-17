'use client';

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
import type { OutboundDailyPoint } from '@/lib/data/analytics/outbound';
import type {
  ConversationStatusBreakdown,
  MessagesByHourPoint,
} from '@/lib/data/analytics/whatsapp';
import { axisProps, chartPalette, gridProps, tooltipStyle } from './chart-theme';

const STATUS_COLORS = {
  Activas: chartPalette.emerald,
  'Con humano': chartPalette.amber,
  Cerradas: chartPalette.slate,
} as const;

export function OutboundTrendChart({ data }: { data: OutboundDailyPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-sm text-zinc-400">
        Sin actividad reciente
      </div>
    );
  }
  const chartData = data.map((d) => ({
    label: new Date(d.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }),
    Completadas: d.ended,
    'Sin contactar': Math.max(0, d.attempted - d.ended - d.failed),
    Fallidas: d.failed,
  }));

  return (
    <ResponsiveContainer width="100%" height={224}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="20%">
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} width={32} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        <Bar dataKey="Completadas" stackId="a" fill={chartPalette.emerald} radius={[0, 0, 0, 0]} />
        <Bar dataKey="Sin contactar" stackId="a" fill={chartPalette.zinc} />
        <Bar dataKey="Fallidas" stackId="a" fill={chartPalette.rose} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MessagesByHourChart({ data }: { data: MessagesByHourPoint[] }) {
  const hasData = data.some((d) => d.inbound + d.outbound > 0);
  if (!hasData) {
    return (
      <div className="h-56 flex items-center justify-center text-sm text-zinc-400">
        Sin mensajes en las últimas 24h
      </div>
    );
  }
  const chartData = data.map((d) => ({
    label: `${d.hour.toString().padStart(2, '0')}:00`,
    Entrantes: d.inbound,
    Salientes: d.outbound,
  }));

  return (
    <ResponsiveContainer width="100%" height={224}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="20%">
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="label" {...axisProps} interval={2} />
        <YAxis {...axisProps} width={32} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        <Bar dataKey="Entrantes" stackId="m" fill={chartPalette.indigo} />
        <Bar dataKey="Salientes" stackId="m" fill={chartPalette.cyan} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ConversationStatusChart({ data }: { data: ConversationStatusBreakdown }) {
  const total = data.active + data.handoff + data.closed;
  if (total === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-sm text-zinc-400">
        Sin conversaciones
      </div>
    );
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
              innerRadius={62}
              outerRadius={92}
              paddingAngle={2}
              stroke="none"
            >
              {chartData.map((d) => (
                <Cell key={d.name} fill={STATUS_COLORS[d.name as keyof typeof STATUS_COLORS]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-semibold tabular-nums">{total}</span>
          <span className="text-[11px] text-zinc-500 uppercase tracking-wider">Total</span>
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
            <span className="tabular-nums font-medium">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
