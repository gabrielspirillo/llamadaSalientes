'use client';

import { Skeleton } from '@/components/ui/feedback';
import dynamic from 'next/dynamic';

/**
 * Carga diferida de lo que depende de `recharts`: la pestaña Resumen es la
 * única que lo usa y no tiene por qué pesar en Movimientos ni en Documentos.
 */
const loading = () => <Skeleton className="h-60 w-full rounded-2xl" />;

export const IncomeExpenseChart = dynamic(
  () => import('./finance-charts').then((m) => m.IncomeExpenseChart),
  { ssr: false, loading },
);

export const CumulativeNetChart = dynamic(
  () => import('./finance-charts').then((m) => m.CumulativeNetChart),
  { ssr: false, loading },
);

export const ShareDonut = dynamic(() => import('./finance-charts').then((m) => m.ShareDonut), {
  ssr: false,
  loading,
});
