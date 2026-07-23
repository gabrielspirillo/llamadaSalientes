// Dataset demo para el dashboard ("Ver Demo"). Números en banda creíble del
// sector dental/estético (no en el récord): no-show ~14%→6%, ~€5.400/mes
// recuperados, tickets reales. Nunca se mezcla con datos reales (el modo demo
// es un estado aparte, activado por ?demo=1). Sin datos de personas reales.
import type {
  NoShowSeriesPoint,
  NoShowStats,
  OptimizedRevenue,
  RecoveryStats,
  TopTreatment,
} from '@/lib/data/analytics/global';
import type { UpcomingAppointment } from '@/lib/data/calls-list';

// Citas confirmadas para hoy (clínica multi-sillón sana).
export const DEMO_TODAY = 21;

// No-show a 90 días: 6% (buen resultado creíble). Coherente: 29 de 480.
export const DEMO_NOSHOW: NoShowStats = { rate: 29 / 480, noShow: 29, finished: 480 };

// Revenue de slots optimizados MTD: €5.400. byChannel suma el total.
export const DEMO_REVENUE: OptimizedRevenue = {
  cents: 540_000,
  currency: 'EUR',
  byChannel: { outbound: 320_000, inbound: 140_000, whatsapp: 80_000 },
};

// Recuperación de cancelaciones: 9 de 12 canceladas re-agendadas (75%).
export const DEMO_RECOVERY: RecoveryStats = { rate: 9 / 12, recovered: 9, totalCancelled: 12 };

// Top tratamientos por volumen (mezcla creíble de ticket alto/bajo).
export const DEMO_TREATMENTS: TopTreatment[] = [
  { treatmentId: 'demo-limpieza', name: 'Limpieza e higiene', count: 82 },
  { treatmentId: 'demo-blanqueamiento', name: 'Blanqueamiento LED', count: 41 },
  { treatmentId: 'demo-revision', name: 'Revisión general', count: 34 },
  { treatmentId: 'demo-ortodoncia', name: 'Ortodoncia · Invisalign', count: 28 },
  { treatmentId: 'demo-implante', name: 'Implante dental', count: 19 },
];

// Tupla tipada con el mismo shape que el Promise.all de GlobalAnalyticsBar,
// para que el destructuring conserve los tipos exactos (sin unión).
export function getDemoAnalytics(): [
  NoShowStats,
  OptimizedRevenue,
  RecoveryStats,
  number,
  TopTreatment[],
  NoShowSeriesPoint[],
] {
  return [
    DEMO_NOSHOW,
    DEMO_REVENUE,
    DEMO_RECOVERY,
    DEMO_TODAY,
    DEMO_TREATMENTS,
    getDemoNoShowSeries(),
  ];
}

// Serie de no-show: 12 semanas con caída de ~14% a ~6% (el "antes vs después"
// del agente). Fechas dinámicas para que "hoy" no quede congelado.
export function getDemoNoShowSeries(): NoShowSeriesPoint[] {
  const now = new Date();
  const weeks = 12;
  const points: NoShowSeriesPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const progress = (weeks - 1 - i) / (weeks - 1); // 0 (más viejo) → 1 (más nuevo)
    const targetRate = 0.14 - progress * 0.08; // 14% → 6%
    const finished = 38 + ((i * 3) % 7); // 38..44, varía por semana
    const noShow = Math.max(1, Math.round(finished * targetRate));
    points.push({
      weekStart: d.toISOString().slice(0, 10),
      finished,
      noShow,
      rate: noShow / finished,
    });
  }
  return points;
}

// Próximas citas: nombres ficticios variados, tratamientos y horarios de
// hoy/mañana. Horas dinámicas relativas a ahora.
export function getDemoUpcoming(): UpcomingAppointment[] {
  const now = new Date();
  const at = (hoursFromNow: number): Date => {
    const d = new Date(now);
    d.setHours(d.getHours() + hoursFromNow, 0, 0, 0);
    return d;
  };
  const rows: Array<{ name: string; treatment: string; hours: number }> = [
    { name: 'María Fernández', treatment: 'Limpieza e higiene', hours: 2 },
    { name: 'Javier Ruiz', treatment: 'Blanqueamiento LED', hours: 4 },
    { name: 'Lucía Gómez', treatment: 'Ortodoncia · Invisalign', hours: 6 },
    { name: 'Andrés Molina', treatment: 'Revisión general', hours: 24 },
    { name: 'Carla Sánchez', treatment: 'Implante dental', hours: 26 },
    { name: 'Diego Herrera', treatment: 'Urgencia · dolor agudo', hours: 28 },
    { name: 'Paula Navarro', treatment: 'Limpieza e higiene', hours: 30 },
    { name: 'Tomás Ortega', treatment: 'Blanqueamiento LED', hours: 48 },
  ];
  return rows.map((r, i) => ({
    callId: `demo-appt-${i}`,
    patientName: r.name,
    phone: null,
    treatmentName: r.treatment,
    startTime: at(r.hours),
  }));
}
