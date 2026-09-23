import { SegmentedNav } from '@/components/ui/tabs';
import { type FinanceParams, type FinanceTab, financeHref } from '@/lib/finance/params';

/**
 * Pestañas del módulo, por URL. Resumen y Ajustes son sólo de quien
 * administra: a recepción no se le enseña una pestaña que el servidor le va a
 * negar igualmente.
 */
export function FinanzasNav({
  params,
  canManage,
  documentsCount,
}: {
  params: FinanceParams;
  canManage: boolean;
  documentsCount?: number;
}) {
  const items: { value: FinanceTab; label: string; count?: number }[] = [
    ...(canManage ? [{ value: 'resumen' as const, label: 'Resumen' }] : []),
    { value: 'movimientos', label: 'Movimientos' },
    { value: 'documentos', label: 'Documentos', count: documentsCount },
    ...(canManage ? [{ value: 'ajustes' as const, label: 'Ajustes' }] : []),
  ];
  return (
    <SegmentedNav
      className="mb-5"
      activeValue={params.tab}
      items={items.map((it) => ({
        value: it.value,
        label: it.label,
        count: it.count,
        href: financeHref(params, { tab: it.value }),
      }))}
    />
  );
}
