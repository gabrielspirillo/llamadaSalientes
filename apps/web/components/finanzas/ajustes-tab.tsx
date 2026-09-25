import { CategoriesPanel } from '@/components/finanzas/categories-panel';
import { InvoiceSettingsForm } from '@/components/finanzas/invoice-settings-form';
import { SettingsForm } from '@/components/finanzas/settings-form';
import { Card, CardTopbar } from '@/components/ui/card';
import { Callout } from '@/components/ui/feedback';
import type { FinanceCategoryRecord, FinanceSettingsRecord } from '@/lib/finance/queries';
import type { InvoiceSettingsRecord } from '@/lib/invoices/service';
import { ArrowDownToLine, ArrowUpFromLine, FileText, Info, Target } from 'lucide-react';

export function AjustesTab({
  categories,
  counts,
  settings,
  invoiceSettings,
  year,
}: {
  categories: FinanceCategoryRecord[];
  counts: Record<string, number>;
  settings: FinanceSettingsRecord;
  invoiceSettings: InvoiceSettingsRecord | null;
  year: number;
}) {
  return (
    <div className="space-y-6">
      <Callout tone="brand" icon={<Info className="h-4 w-4" />} title="Qué es un coste fijo">
        Lo que se paga haya o no pacientes: alquiler, cuota de autónomos, seguros, software. La
        tarjeta «Punto de equilibrio» del Resumen sale de ahí (cuántas sesiones al mes cubren esos
        fijos), así que conviene marcar bien esa casilla. El material o las comisiones del TPV son
        variables: van con la actividad. Todo lo de esta pestaña se guarda al momento.
      </Callout>
      <Card>
        <CardTopbar
          icon={<Target className="h-4 w-4" />}
          tone="sky"
          title="Objetivo mensual"
          subtitle="La barra del Resumen mide contra esto"
        />
        <SettingsForm monthlyRevenueGoalCents={settings.monthlyRevenueGoalCents} />
      </Card>
      <Card>
        <CardTopbar
          icon={<FileText className="h-4 w-4" />}
          tone="grape"
          title="Datos de facturación"
          subtitle="Lo que va impreso en cada factura que se emite desde la ficha del paciente"
        />
        <InvoiceSettingsForm settings={invoiceSettings} year={year} />
      </Card>
      <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-2">
        <Card>
          <CardTopbar
            icon={<ArrowUpFromLine className="h-4 w-4" />}
            tone="honey"
            title="Categorías de gasto"
            subtitle="Ordena, renombra, marca como fijo o archiva"
          />
          <CategoriesPanel kind="EXPENSE" categories={categories} counts={counts} />
        </Card>
        <Card>
          <CardTopbar
            icon={<ArrowDownToLine className="h-4 w-4" />}
            tone="mint"
            title="Categorías de ingreso"
            subtitle="Para lo que no viene de una cita"
          />
          <CategoriesPanel kind="INCOME" categories={categories} counts={counts} />
        </Card>
      </div>
    </div>
  );
}
