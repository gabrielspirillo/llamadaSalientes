import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Versión desplegada (el commit con el que se construyó la imagen). La usa
 * `VersionWatch` para saber si la pestaña abierta se quedó con el código de un
 * despliegue anterior: al navegar dentro del panel, Next no recarga el CSS ni
 * el JS, y una pestaña abierta desde la mañana seguía con los fallos ya
 * arreglados (Raquel, 17/11/2026).
 */
export function GET() {
  return NextResponse.json(
    { sha: process.env.NEXT_PUBLIC_BUILD_SHA ?? null },
    { headers: { 'cache-control': 'no-store' } },
  );
}
