'use client';

import { AreaChart, BarList, DonutChart } from '@tremor/react';

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
  // Tremor espera fechas legibles
  const chartData = data.map((d) => ({
    Día: new Date(d.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }),
    Total: d.calls,
    Agendadas: d.agendar,
    Canceladas: d.cancelar,
    Otras: d.otro,
  }));

  return (
    <AreaChart
      data={chartData}
      index="Día"
      categories={['Agendadas', 'Canceladas', 'Otras']}
      colors={['emerald', 'amber', 'slate']}
      stack
      showAnimation
      showLegend
      yAxisWidth={36}
      className="h-72"
    />
  );
}

export function IntentDonut({ data }: { data: Intent[] }) {
  const chartData = data.map((d) => ({
    name: intentLabels[d.intent] ?? d.intent,
    value: d.count,
  }));
  return (
    <DonutChart
      data={chartData}
      category="value"
      index="name"
      colors={['emerald', 'blue', 'amber', 'violet', 'red', 'slate']}
      showAnimation
      className="h-56"
    />
  );
}

export function IntentBarList({ data }: { data: Intent[] }) {
  const items = data.map((d) => ({
    name: intentLabels[d.intent] ?? d.intent,
    value: d.count,
  }));
  return <BarList data={items} className="text-sm" />;
}
