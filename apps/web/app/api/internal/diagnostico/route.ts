import { createHash, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db/client';
import { guardDiagnosticQuery } from '@/lib/diagnostics/sql-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Consulta de SOLO LECTURA a la base de producción, para diagnosticar sin
 * abrir el puerto de Postgres ni SSH. Se activa sólo si `DIAGNOSTIC_TOKEN`
 * (32+ caracteres) está en el entorno del servicio web; sin él responde 404.
 *
 * Cuatro cierres: la clave en la cabecera `x-diagnostic-token` (comparada en
 * tiempo constante), una sola sentencia SELECT (`guardDiagnosticQuery`), una
 * transacción READ ONLY con tope de 15 s, y como mucho 500 filas devueltas.
 * El log guarda la huella de la consulta, nunca su texto ni las filas: pueden
 * llevar nombres de pacientes.
 */
const MAX_ROWS = 500;

function digest(v: string): Buffer {
  return createHash('sha256').update(v).digest();
}

export async function POST(req: Request) {
  const expected = process.env.DIAGNOSTIC_TOKEN ?? '';
  if (expected.length < 32) return new NextResponse(null, { status: 404 });
  const given = req.headers.get('x-diagnostic-token') ?? '';
  if (!timingSafeEqual(digest(given), digest(expected))) {
    return NextResponse.json({ error: 'Clave inválida.' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { query?: unknown } | null;
  const guard = guardDiagnosticQuery(body?.query);
  if (!guard.ok) return NextResponse.json({ error: guard.reason }, { status: 400 });

  const started = Date.now();
  const fingerprint = digest(guard.query).toString('hex').slice(0, 12);
  try {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`set transaction read only`);
      await tx.execute(sql`set local statement_timeout = 15000`);
      return (await tx.execute(sql.raw(guard.query))) as unknown as Record<string, unknown>[];
    });
    const list = Array.from(rows);
    console.log('[diagnostico] consulta', {
      fingerprint,
      rows: list.length,
      ms: Date.now() - started,
    });
    return NextResponse.json({
      rowCount: list.length,
      truncated: list.length > MAX_ROWS,
      ms: Date.now() - started,
      rows: list.slice(0, MAX_ROWS),
    });
  } catch (err) {
    console.warn('[diagnostico] consulta fallida', { fingerprint, ms: Date.now() - started });
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
