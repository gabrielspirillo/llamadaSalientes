'use client';

import { Skeleton } from '@/components/ui/feedback';
import dynamic from 'next/dynamic';

/**
 * Carga diferida de todo lo que depende de `recharts` (~90-130 kB gzip).
 *
 * Los gráficos entraban estáticamente en el bundle de `/dashboard`, que es la
 * primera pantalla después del login, y siempre están bajo el pliegue. Con
 * `ssr: false` además no se serializan dos veces (HTML + payload RSC).
 */

const loading = () => <Skeleton className="h-60 w-full rounded-2xl" />;

export const NoShowTrendChart = dynamic(
  () => import('./analytics-global-charts').then((m) => m.NoShowTrendChart),
  { ssr: false, loading },
);

export const TopTreatmentsChart = dynamic(
  () => import('./analytics-global-charts').then((m) => m.TopTreatmentsChart),
  { ssr: false, loading },
);

export const CallsTrendChart = dynamic(
  () => import('./analytics-charts').then((m) => m.CallsTrendChart),
  { ssr: false, loading },
);

export const IntentDonut = dynamic(
  () => import('./analytics-charts').then((m) => m.IntentDonut),
  { ssr: false, loading },
);

export const IntentBarList = dynamic(
  () => import('./analytics-charts').then((m) => m.IntentBarList),
  { ssr: false, loading },
);

export const OutboundTrendChart = dynamic(
  () => import('./analytics-module-charts').then((m) => m.OutboundTrendChart),
  { ssr: false, loading },
);

export const MessagesByHourChart = dynamic(
  () => import('./analytics-module-charts').then((m) => m.MessagesByHourChart),
  { ssr: false, loading },
);

export const ConversationStatusChart = dynamic(
  () => import('./analytics-module-charts').then((m) => m.ConversationStatusChart),
  { ssr: false, loading },
);
