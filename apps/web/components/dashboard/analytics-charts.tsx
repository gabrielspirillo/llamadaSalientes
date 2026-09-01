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
import {
  axisProps,
  chartAnim,
  chartPalette,
  chartSequence,
  gridProps,
  tooltipStyle,
} from './chart-theme';

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
            <stop offset="0%" stopColor={chartPalette.emerald} stopOpacity={0.42} />
            <stop offset="100%" stopColor={chartPalette.emerald} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gCanceladas" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={chartPalette.amber} stopOpacity={0.42} />
            <stop offset="100%" stopColor={chartPalette.amber} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gOtras" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={chartPalette.violet} stopOpacity={0.42} />
            <stop offset="100%" stopColor={chartPalette.violet} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} width={32} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: '#ddd8ef' }} />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, paddingTop: 10, fontWeight: 500 }}
        />
        <Area
          type="monotone"
          dataKey="Agendadas"
          stackId="1"
          stroke={chartPalette.emerald}
          strokeWidth={2.5}
          fill="url(#gAgendadas)"
          {...chartAnim}
        />
        <Area
          type="monotone"
          dataKey="Canceladas"
          stackId="1"
          stroke={chartPalette.amber}
          strokeWidth={2.5}
          fill="url(#gCanceladas)"
          {...chartAnim}
        />
        <Area
          type="monotone"
          dataKey="Otras"
          stackId="1"
          stroke={chartPalette.violet}
          strokeWidth={2.5}
          fill="url(#gOtras)"
          {...chartAnim}
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
            innerRadius={58}
            outerRadius={88}
            paddingAngle={3}
            cornerRadius={6}
            stroke="none"
            {...chartAnim}
          >
            {chartData.map((_, i) => (
              <Cell key={i} fill={chartSequence[i % chartSequence.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-[26px] font-bold leading-none tabular-nums text-zinc-900">
          {total}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
          Total
        </span>
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
          <li key={item.name} className="flex items-center gap-3 text-[13px]">
            <span className="w-24 truncate font-medium text-zinc-600">{item.name}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="bar-fill h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  backgroundColor: color,
                  ['--bar-delay' as string]: `${120 + i * 80}ms`,
                }}
              />
            </div>
            <span className="w-8 text-right font-bold tabular-nums text-zinc-800">
              {item.value}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
