import { type NextRequest, NextResponse } from 'next/server';

import { getClinicTimezone } from '@/lib/agenda/queries';
import { FinanceForbiddenError, requireFinanceManager } from '@/lib/finance/auth';
import { ledgerToCsv, linesTouchingRange, matchesFilters, sortLedger } from '@/lib/finance/model';
import { parseFinanceParams } from '@/lib/finance/params';
import { loadFinanceLedger } from '@/lib/finance/queries';
import { localDateKey } from '@/lib/tasks/tz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * El libro en CSV (punto y coma, coma decimal, BOM) para la gestoría. Mismos
 * filtros que la pestaña Movimientos: se exporta lo que se está viendo. Sólo
 * el administrador: son las cuentas de la clínica.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  let tenantId: string;
  try {
    tenantId = (await requireFinanceManager()).tenantId;
  } catch (err) {
    if (err instanceof FinanceForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const tz = await getClinicTimezone(tenantId);
  const todayKey = localDateKey(new Date(), tz);
  const raw: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    raw[k] = v;
  });
  const params = parseFinanceParams(raw, todayKey, { canManage: true });

  const ledger = await loadFinanceLedger(tenantId, {
    from: params.period.from,
    to: params.period.to,
    tz,
  });
  const lines = sortLedger(
    linesTouchingRange(ledger, params.period).filter((l) => matchesFilters(l, params.filters)),
    params.basis,
  );
  const csv = ledgerToCsv(lines);
  const name = `finanzas-${params.period.from}-${params.period.to}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
