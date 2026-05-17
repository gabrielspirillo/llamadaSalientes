'use client';

import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { NoShowSeriesPoint, TopTreatment } from '@/lib/data/analytics/global';
import { axisProps, chartPalette, chartSequence, gridProps, tooltipStyle } from './chart-theme';

export function NoShowTrendChart({ data }: { data: NoShowSeriesPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-sm text-zinc-400">
        Sin datos aún
      </div>
    );
  }
  const chartData = data.map((p) => ({
    label: new Date(p.weekStart).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
    }),
    value: Number((p.rate * 100).toFixed(1)),
  }));

  return (
    <ResponsiveContainer width="100%" height={224}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis
          {...axisProps}
          width={36}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v) => [`${v}%`, 'No-show']}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={chartPalette.rose}
          strokeWidth={2.5}
          dot={{ r: 3, fill: chartPalette.rose, strokeWidth: 0 }}
          activeDot={{ r: 5, fill: chartPalette.rose, strokeWidth: 2, stroke: '#fff' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function TopTreatmentsChart({ data }: { data: TopTreatment[] }) {
  if (data.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-sm text-zinc-400">
        Sin citas aún
      </div>
    );
  }
  const chartData = data.map((t) => ({ name: t.name, value: t.count }));
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
        <span className="text-[11px] text-zinc-500 uppercase tracking-wider">Citas</span>
      </div>
    </div>
  );
}
