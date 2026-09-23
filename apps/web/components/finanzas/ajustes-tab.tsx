import { CategoriesPanel } from '@/components/finanzas/categories-panel';
import { SettingsForm } from '@/components/finanzas/settings-form';
import { Card, CardTopbar } from '@/components/ui/card';
import { Callout } from '@/components/ui/feedback';
import type { FinanceCategoryRecord, FinanceSettingsRecord } from '@/lib/finance/queries';
import { ArrowDownToLine, ArrowUpFromLine, Info, Target } from 'lucide-react';

export function AjustesTab({
  categories,
  settings,
}: {
  categories: FinanceCategoryRecord[];
  settings: FinanceSettingsRecord;
}) {
  return (
    <div className="space-y-6">
      <Callout tone="brand" icon={<Info className="h-4 w-4" />} title="Qué es un coste fijo">
        Lo que se paga haya o no pacientes: alquiler, cuota de autónomos, seguros, software. El
        punto de equilibrio del Resumen sale de ahí, así que conviene marcar bien esa casilla. El
        material o las comisiones del TPV son variables: van con la actividad.
      </Callout>
      <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-2">
        <Card>
          <CardTopbar
            icon={<ArrowUpFromLine className="h-4 w-4" />}
            tone="honey"
            title="Categorías de gasto"
            subtitle="Renombra, marca como fijo o archiva"
          />
          <CategoriesPanel kind="EXPENSE" categories={categories} />
        </Card>
        <div className="flex flex-col gap-4 sm:gap-6">
          <Card>
            <CardTopbar
              icon={<ArrowDownToLine className="h-4 w-4" />}
              tone="mint"
              title="Categorías de ingreso"
              subtitle="Para lo que no viene de una cita"
            />
            <CategoriesPanel kind="INCOME" categories={categories} />
          </Card>
          <Card>
            <CardTopbar
              icon={<Target className="h-4 w-4" />}
              tone="sky"
              title="Objetivo mensual"
              subtitle="La barra del Resumen mide contra esto"
            />
            <SettingsForm monthlyRevenueGoalCents={settings.monthlyRevenueGoalCents} />
          </Card>
        </div>
      </div>
    </div>
  );
}
