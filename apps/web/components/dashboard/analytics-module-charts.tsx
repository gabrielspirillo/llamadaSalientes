'use client';

import { BarChart, DonutChart } from '@tremor/react';
import type { OutboundDailyPoint } from '@/lib/data/analytics/outbound';
import type {
  ConversationStatusBreakdown,
  MessagesByHourPoint,
} from '@/lib/data/analytics/whatsapp';

export function OutboundTrendChart({ data }: { data: OutboundDailyPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-sm text-zinc-400">
        Sin actividad reciente
      </div>
    );
  }
  const chartData = data.map((d) => ({
    Día: new Date(d.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }),
    Completadas: d.ended,
    'Sin contactar': Math.max(0, d.attempted - d.ended - d.failed),
    Fallidas: d.failed,
  }));
  return (
    <BarChart
      data={chartData}
      index="Día"
      categories={['Completadas', 'Sin contactar', 'Fallidas']}
      colors={['emerald', 'zinc', 'rose']}
      stack
      yAxisWidth={36}
      showAnimation
      className="h-56"
    />
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
    Hora: `${d.hour.toString().padStart(2, '0')}:00`,
    Entrantes: d.inbound,
    Salientes: d.outbound,
  }));
  return (
    <BarChart
      data={chartData}
      index="Hora"
      categories={['Entrantes', 'Salientes']}
      colors={['indigo', 'cyan']}
      stack
      yAxisWidth={36}
      showAnimation
      className="h-56"
    />
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
    <DonutChart
      data={chartData}
      category="value"
      index="name"
      colors={['emerald', 'amber', 'zinc']}
      showAnimation
      className="h-56"
    />
  );
}
