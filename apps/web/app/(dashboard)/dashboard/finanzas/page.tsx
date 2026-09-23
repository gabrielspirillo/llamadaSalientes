import { ModuleGate } from '@/components/dashboard/module-gate';
import { PageHeader } from '@/components/dashboard/page-header';
import { AjustesTab } from '@/components/finanzas/ajustes-tab';
import { DocumentosTab, documentsFromLedger } from '@/components/finanzas/documentos-tab';
import { EntryDialog } from '@/components/finanzas/entry-dialog';
import { MovimientosTab } from '@/components/finanzas/movimientos-tab';
import { ResumenTab } from '@/components/finanzas/resumen-tab';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { getClinicTimezone } from '@/lib/agenda/queries';
import { type FinanceAccess, FinanceForbiddenError, getFinanceAccess } from '@/lib/finance/auth';
import { linesTouchingRange, monthKeyOf } from '@/lib/finance/model';
import { type RawSearchParams, financeQuery, parseFinanceParams } from '@/lib/finance/params';
import {
  countEntriesByCategory,
  countRecurringCandidates,
  getFinanceSettings,
  listCounterparties,
  listFinanceCategories,
  listFinanceProfessionals,
  loadFinanceLedger,
} from '@/lib/finance/queries';
import { ensureFinanceProvisioned } from '@/lib/finance/service';
import { localDateKey } from '@/lib/tasks/tz';
import { Download, Lock, Wallet } from 'lucide-react';
import { FinanzasNav } from './finanzas-nav';

export const dynamic = 'force-dynamic';

/**
 * Módulo Finanzas: ingresos contra gastos, comprobantes y la salud del negocio.
 *
 * Una sola carga del libro por render (la ventana cubre el período y su
 * anterior) y de ahí sale todo: cada pestaña se resuelve por URL y sólo se
 * pinta la activa. El módulo es contratable: `ModuleGate` lo bloquea a la
 * vista en las clínicas que no lo tienen.
 */
export default async function FinanzasPage({
  searchParams,
}: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;

  let access: FinanceAccess;
  try {
    access = await getFinanceAccess();
  } catch (err) {
    if (err instanceof FinanceForbiddenError) return <NoAccess />;
    throw err;
  }

  const tz = await getClinicTimezone(access.tenantId);
  const todayKey = localDateKey(new Date(), tz);
  const params = parseFinanceParams(sp, todayKey, { canManage: access.canManage });

  // Primera visita: siembra las categorías. Idempotente y barato el resto de veces.
  await ensureFinanceProvisioned(access.tenantId).catch((err) =>
    console.warn('[finanzas] no se pudieron sembrar las categorías', (err as Error).message),
  );

  const [categories, professionals, settings, ledger, counterparties, recurring, categoryCounts] =
    await Promise.all([
      listFinanceCategories(access.tenantId, { includeInactive: true }),
      listFinanceProfessionals(access.tenantId),
      getFinanceSettings(access.tenantId),
      loadFinanceLedger(access.tenantId, {
        from: params.period.previous.from,
        to: params.period.to,
        tz,
      }),
      access.canWrite ? listCounterparties(access.tenantId) : Promise.resolve([]),
      params.tab === 'movimientos' && access.canWrite
        ? countRecurringCandidates(access.tenantId, monthKeyOf(todayKey))
        : Promise.resolve({ candidates: 0, alreadyCopied: 0 }),
      params.tab === 'ajustes' ? countEntriesByCategory(access.tenantId) : Promise.resolve({}),
    ]);

  const activeCategories = categories.filter((c) => c.active);
  const activeProfessionals = professionals.filter((p) => p.active);
  const documentsCount = documentsFromLedger(linesTouchingRange(ledger, params.period)).length;

  // Las acciones de cabecera sólo donde aplican: exportar y cargar movimientos
  // no tienen sentido en Ajustes, y en el Resumen ya hay entrada propia.
  const showExport =
    access.canManage && (params.tab === 'movimientos' || params.tab === 'documentos');
  const showNew = access.canWrite && (params.tab === 'movimientos' || params.tab === 'documentos');

  return (
    <ModuleGate moduleKey="finance">
      <PageHeader
        eyebrow="Negocio"
        icon={<Wallet className="h-5 w-5" />}
        title="Finanzas"
        description="Lo que entra, lo que sale, los comprobantes y si la clínica va bien."
        actions={
          showExport || showNew ? (
            <>
              {showExport && (
                <Button asChild variant="secondary">
                  <a href={`/api/finanzas/export?${financeQuery(params).toString()}`}>
                    <Download className="h-4 w-4" /> Exportar CSV
                  </a>
                </Button>
              )}
              {showNew && (
                <EntryDialog
                  mode="create"
                  categories={activeCategories}
                  professionals={activeProfessionals}
                  counterparties={counterparties}
                  todayKey={todayKey}
                />
              )}
            </>
          ) : undefined
        }
      />

      <FinanzasNav params={params} canManage={access.canManage} documentsCount={documentsCount} />

      {params.tab === 'resumen' && (
        <ResumenTab
          params={params}
          ledger={ledger}
          categories={categories}
          professionals={professionals}
          counterparties={counterparties}
          settings={settings}
          todayKey={todayKey}
        />
      )}
      {params.tab === 'movimientos' && (
        <MovimientosTab
          params={params}
          ledger={ledger}
          categories={categories}
          professionals={professionals}
          counterparties={counterparties}
          recurring={recurring}
          todayKey={todayKey}
          canWrite={access.canWrite}
          canManage={access.canManage}
        />
      )}
      {params.tab === 'documentos' && (
        <DocumentosTab
          params={params}
          ledger={ledger}
          categories={categories}
          professionals={professionals}
          counterparties={counterparties}
          todayKey={todayKey}
          canWrite={access.canWrite}
        />
      )}
      {params.tab === 'ajustes' && (
        <AjustesTab categories={categories} counts={categoryCounts} settings={settings} />
      )}
    </ModuleGate>
  );
}

function NoAccess() {
  return (
    <>
      <PageHeader eyebrow="Negocio" icon={<Wallet className="h-5 w-5" />} title="Finanzas" />
      <Card>
        <EmptyState
          icon={<Lock className="h-5 w-5" />}
          title="Finanzas es para el equipo de la clínica"
          description="Tu rol sólo permite consultar el panel. Pídele a un administrador que te dé acceso de operador si tienes que cargar gastos o comprobantes."
        />
      </Card>
    </>
  );
}
