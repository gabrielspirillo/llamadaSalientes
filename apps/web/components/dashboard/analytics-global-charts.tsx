'use client';

import { DonutChart, LineChart } from '@tremor/react';
import type { NoShowSeriesPoint, TopTreatment } from '@/lib/data/analytics/global';

export function NoShowTrendChart({ data }: { data: NoShowSeriesPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-sm text-zinc-400">
        Sin datos aún
      </div>
    );
  }
  const chartData = data.map((p) => ({
    Semana: new Date(p.weekStart).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
    }),
    'No-show %': Number((p.rate * 100).toFixed(1)),
  }));
  return (
    <LineChart
      data={chartData}
      index="Semana"
      categories={['No-show %']}
      colors={['rose']}
      yAxisWidth={40}
      valueFormatter={(v) => `${v}%`}
      showLegend={false}
      showAnimation
      className="h-56"
    />
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
  return (
    <DonutChart
      data={chartData}
      category="value"
      index="name"
      colors={['indigo', 'cyan', 'emerald', 'amber', 'rose']}
      showAnimation
      className="h-56"
    />
  );
}
