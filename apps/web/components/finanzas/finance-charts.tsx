'use client';

import {
  axisProps,
  chartAnim,
  chartPalette,
  chartSequence,
  gridProps,
  tooltipStyle,
} from '@/components/dashboard/chart-theme';
import { type SeriesPoint, formatCents } from '@/lib/finance/model';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Gráficos del módulo Finanzas. Tema Aurora (`chart-theme.ts`) y las reglas
 * de siempre: un solo eje por gráfico, leyenda cuando hay más de una serie,
 * el color sigue a la entidad (una categoría conserva su color aunque cambie
 * el filtro) y el texto va en tinta, nunca en el color de la serie.
 */

/** Ingresos y gastos son dos entidades fijas: verde de marca y gris neutro. */
export const INCOME_COLOR = chartPalette.brand;
export const EXPENSE_COLOR = '#9aa8a3';
export const NET_COLOR = '#27403a';

function euros(cents: number): number {
  return Math.round(cents) / 100;
}

function eurosLabel(value: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="flex h-56 flex-col items-center justify-center gap-2 text-sm text-zinc-400">
      <span className="inline-flex h-10 w-10 animate-float items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#effaf5,#ddf3ea)]" />
      {label}
    </div>
  );
}

/** Ingresos contra gastos por cubo, con el resultado como línea sobre el mismo eje. */
export function IncomeExpenseChart({ points }: { points: SeriesPoint[] }) {
  if (points.every((p) => p.incomeCents === 0 && p.expenseCents === 0)) {
    return <ChartEmpty label="Sin movimientos en el período" />;
  }
  const data = points.map((p) => ({
    label: p.label,
    Ingresos: euros(p.incomeCents),
    Gastos: euros(p.expenseCents),
    Resultado: euros(p.netCents),
  }));
  const dense = data.length > 16;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        barGap={2}
        barCategoryGap="28%"
      >
        <CartesianGrid {...gridProps} />
        <XAxis
          dataKey="label"
          {...axisProps}
          interval={dense ? 'preserveStartEnd' : 0}
          minTickGap={18}
        />
        <YAxis {...axisProps} width={60} tickFormatter={(v: number) => eurosLabel(v)} />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: 'rgba(95,168,150,0.06)' }}
          formatter={(v) => formatCents(Math.round(Number(v) * 100))}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, paddingTop: 10, fontWeight: 500 }}
        />
        <Bar
          dataKey="Ingresos"
          fill={INCOME_COLOR}
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
          {...chartAnim}
        />
        <Bar
          dataKey="Gastos"
          fill={EXPENSE_COLOR}
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
          {...chartAnim}
        />
        <Line
          type="monotone"
          dataKey="Resultado"
          stroke={NET_COLOR}
          strokeWidth={2}
          dot={dense ? false : { r: 3, fill: '#fff', stroke: NET_COLOR, strokeWidth: 2 }}
          activeDot={{ r: 5, fill: NET_COLOR, stroke: '#fff', strokeWidth: 2 }}
          {...chartAnim}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** El resultado acumulado a lo largo del período: si sube, la clínica gana. */
export function CumulativeNetChart({ points }: { points: SeriesPoint[] }) {
  if (points.every((p) => p.incomeCents === 0 && p.expenseCents === 0)) {
    return <ChartEmpty label="Sin movimientos en el período" />;
  }
  const data = points.map((p) => ({ label: p.label, value: euros(p.cumulativeNetCents) }));
  const last = data[data.length - 1]?.value ?? 0;
  const color = last >= 0 ? chartPalette.brand : chartPalette.rose;
  return (
    <ResponsiveContainer width="100%" height={224}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="finNetFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={18} />
        <YAxis {...axisProps} width={60} tickFormatter={(v: number) => eurosLabel(v)} />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ stroke: '#ddd8ef' }}
          formatter={(v) => [formatCents(Math.round(Number(v) * 100)), 'Acumulado']}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill="url(#finNetFill)"
          activeDot={{ r: 5, fill: color, strokeWidth: 2, stroke: '#fff' }}
          {...chartAnim}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface DonutSlice {
  name: string;
  cents: number;
  /** Índice estable de color: el de la entidad, no su posición en el ranking. */
  colorIndex: number;
}

/** Reparte por entidad. Más de 7 porciones se pliegan en «Otros». */
export function ShareDonut({ slices, centerLabel }: { slices: DonutSlice[]; centerLabel: string }) {
  const positive = slices.filter((s) => s.cents > 0);
  if (positive.length === 0) return <ChartEmpty label="Nada que repartir" />;
  const sorted = [...positive].sort((a, b) => b.cents - a.cents);
  const head = sorted.slice(0, 7);
  const tail = sorted.slice(7);
  const data = [
    ...head.map((s) => ({
      name: s.name,
      value: euros(s.cents),
      color: chartSequence[s.colorIndex % chartSequence.length],
    })),
    ...(tail.length > 0
      ? [
          {
            name: 'Otros',
            value: euros(tail.reduce((acc, s) => acc + s.cents, 0)),
            color: chartPalette.zinc,
          },
        ]
      : []),
  ];
  const total = data.reduce((acc, d) => acc + d.value, 0);
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Tooltip
            contentStyle={tooltipStyle}
            wrapperStyle={{ zIndex: 50 }}
            formatter={(v, name) => [
              `${formatCents(Math.round(Number(v) * 100))} · ${total > 0 ? Math.round((Number(v) / total) * 100) : 0} %`,
              String(name),
            ]}
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={60}
            outerRadius={92}
            paddingAngle={2}
            stroke="#fff"
            strokeWidth={2}
            {...chartAnim}
          >
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[18px] font-bold tabular-nums text-zinc-900">
          {eurosLabel(total)}
        </span>
        <span className="text-[11px] font-medium text-zinc-500">{centerLabel}</span>
      </div>
    </div>
  );
}

/** Serie simple para el sparkline de los KPI (en euros). */
export function trendFromSeries(
  points: SeriesPoint[],
  key: 'incomeCents' | 'expenseCents' | 'netCents',
): number[] {
  return points.map((p) => euros(p[key]));
}

/** Una línea de referencia contra el objetivo mensual, si lo hay. */
export function GoalLineChart({ points, goalCents }: { points: SeriesPoint[]; goalCents: number }) {
  const data = points.map((p) => ({
    label: p.label,
    Ingresos: euros(p.incomeCents),
    Objetivo: euros(goalCents),
  }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={18} />
        <YAxis {...axisProps} width={60} tickFormatter={(v: number) => eurosLabel(v)} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v) => formatCents(Math.round(Number(v) * 100))}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, paddingTop: 10, fontWeight: 500 }}
        />
        <Line
          type="monotone"
          dataKey="Ingresos"
          stroke={INCOME_COLOR}
          strokeWidth={2}
          dot={false}
          {...chartAnim}
        />
        <Line
          type="monotone"
          dataKey="Objetivo"
          stroke={chartPalette.zinc}
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={false}
          {...chartAnim}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
