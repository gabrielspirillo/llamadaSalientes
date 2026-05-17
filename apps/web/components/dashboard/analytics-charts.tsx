'use client';

import {
  Area,
  AreaChart,
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
import { axisProps, chartPalette, chartSequence, gridProps, tooltipStyle } from './chart-theme';

type ByDay = { date: string; calls: number; agendar: number; cancelar: number; otro: number };
type Intent = { intent: string; count: number };

const intentLabels: Record<string, string> = {
  agendar: 'Agendar',
  reagendar: 'Reagendar',
  cancelar: 'Cancelar',
  pregunta: 'Pregunta',
  queja: 'Queja',
  otro: 'Otro',
  sin_clasificar: 'Sin clasificar',
};

export function CallsTrendChart({ data }: { data: ByDay[] }) {
  const chartData = data.map((d) => ({
    label: new Date(d.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }),
    Agendadas: d.agendar,
    Canceladas: d.cancelar,
    Otras: d.otro,
  }));

  return (
    <ResponsiveContainer width="100%" height={288}>
      <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="gAgendadas" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={chartPalette.emerald} stopOpacity={0.4} />
            <stop offset="100%" stopColor={chartPalette.emerald} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gCanceladas" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={chartPalette.amber} stopOpacity={0.4} />
            <stop offset="100%" stopColor={chartPalette.amber} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gOtras" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={chartPalette.indigo} stopOpacity={0.4} />
            <stop offset="100%" stopColor={chartPalette.indigo} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} width={32} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: '#e5e7eb' }} />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
        />
        <Area
          type="monotone"
          dataKey="Agendadas"
          stackId="1"
          stroke={chartPalette.emerald}
          strokeWidth={2}
          fill="url(#gAgendadas)"
        />
        <Area
          type="monotone"
          dataKey="Canceladas"
          stackId="1"
          stroke={chartPalette.amber}
          strokeWidth={2}
          fill="url(#gCanceladas)"
        />
        <Area
          type="monotone"
          dataKey="Otras"
          stackId="1"
          stroke={chartPalette.indigo}
          strokeWidth={2}
          fill="url(#gOtras)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function IntentDonut({ data }: { data: Intent[] }) {
  const chartData = data.map((d) => ({
    name: intentLabels[d.intent] ?? d.intent,
    value: d.count,
  }));
  const total = chartData.reduce((acc, d) => acc + d.value, 0);

  return (
    <div className="relative">
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
            {chartData.map((_, i) => (
              <Cell key={i} fill={chartSequence[i % chartSequence.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-2xl font-semibold tabular-nums">{total}</span>
        <span className="text-[11px] text-zinc-500 uppercase tracking-wider">Total</span>
      </div>
    </div>
  );
}

export function IntentBarList({ data }: { data: Intent[] }) {
  const items = data.map((d) => ({
    name: intentLabels[d.intent] ?? d.intent,
    value: d.count,
  }));
  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <ul className="space-y-2">
      {items.map((item, i) => {
        const pct = (item.value / max) * 100;
        const color = chartSequence[i % chartSequence.length];
        return (
          <li key={item.name} className="flex items-center gap-3 text-sm">
            <span className="w-24 truncate text-zinc-600">{item.name}</span>
            <div className="flex-1 h-2 rounded-full bg-zinc-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
            <span className="w-8 text-right tabular-nums font-medium">{item.value}</span>
          </li>
        );
      })}
    </ul>
  );
}
