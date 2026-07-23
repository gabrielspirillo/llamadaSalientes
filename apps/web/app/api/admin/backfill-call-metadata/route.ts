import { db } from '@/lib/db/client';
import { callEvents, calls } from '@/lib/db/schema';
import { getRetellClient } from '@/lib/retell/client';
import { getCurrentTenant } from '@/lib/tenant';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min max

const BATCH = 500;

type RetellCallShape = {
  from_number?: string | null;
  to_number?: string | null;
  start_timestamp?: number | null;
  end_timestamp?: number | null;
  duration_ms?: number | null;
  disconnection_reason?: string | null;
  call_status?: string | null;
};

type MetadataPatch = {
  fromNumber?: string;
  toNumber?: string;
  startedAt?: Date;
  endedAt?: Date;
  durationSeconds?: number;
  transferred?: boolean;
};

/**
 * Reconstruye from/to number, timestamps y duración de llamadas viejas.
 *
 * Contexto: hasta el fix de `upsertCall`, el evento `call_analyzed` pisaba con
 * NULL todas las columnas que no mandaba (número, inicio, fin, duración), así
 * que la tabla de /dashboard/calls quedaba casi vacía. El payload crudo de cada
 * evento sí quedó guardado en `call_events`, así que de ahí se recupera todo
 * sin depender de la API de Retell.
 *
 * Fuente 1: call_events (gratis, offline).
 * Fuente 2: API de Retell, solo para las que no se pudieron resolver.
 *
 * Solo escribe columnas que hoy están en NULL — nunca pisa datos buenos.
 */
export async function POST(_req: NextRequest) {
  let tenantId: string;
  try {
    const ctx = await getCurrentTenant();
    tenantId = ctx.tenant.id;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await db
    .select({
      id: calls.id,
      retellCallId: calls.retellCallId,
      fromNumber: calls.fromNumber,
      toNumber: calls.toNumber,
      startedAt: calls.startedAt,
      endedAt: calls.endedAt,
      durationSeconds: calls.durationSeconds,
    })
    .from(calls)
    .where(
      and(
        eq(calls.tenantId, tenantId),
        or(
          isNull(calls.startedAt),
          isNull(calls.endedAt),
          isNull(calls.durationSeconds),
          and(isNull(calls.fromNumber), isNull(calls.toNumber)),
        ),
      ),
    )
    .limit(BATCH);

  if (rows.length === 0) {
    return NextResponse.json({ scanned: 0, fromEvents: 0, fromRetell: 0, unresolved: 0 });
  }

  // Todos los eventos crudos de esas llamadas, de una sola query.
  const retellIds = rows.map((r) => r.retellCallId);
  const events = await db
    .select({
      callId: callEvents.callId,
      event: callEvents.event,
      payload: callEvents.payload,
    })
    .from(callEvents)
    .where(and(eq(callEvents.tenantId, tenantId), inArray(callEvents.callId, retellIds)));

  // Prioridad: call_ended y call_analyzed traen los datos completos.
  const order: Record<string, number> = { call_started: 0, call_analyzed: 1, call_ended: 2 };
  const byCall = new Map<string, RetellCallShape[]>();
  for (const e of events.sort((a, b) => (order[a.event] ?? 0) - (order[b.event] ?? 0))) {
    const list = byCall.get(e.callId) ?? [];
    list.push(e.payload as RetellCallShape);
    byCall.set(e.callId, list);
  }

  let fromEvents = 0;
  let fromRetell = 0;
  const unresolved: string[] = [];
  const retellAvailable = !!process.env.RETELL_API_KEY;

  for (const row of rows) {
    let patch = mergePatch(byCall.get(row.retellCallId) ?? [], row);

    // Fallback: pedirle el call a Retell si los eventos no alcanzaron.
    if (Object.keys(patch).length === 0 && retellAvailable) {
      try {
        const remote = (await getRetellClient().call.retrieve(
          row.retellCallId,
        )) as unknown as RetellCallShape;
        patch = mergePatch([remote], row);
        if (Object.keys(patch).length > 0) {
          await applyPatch(row.id, patch);
          fromRetell += 1;
          continue;
        }
      } catch (err) {
        console.error('[backfill-call-metadata] retell retrieve falló:', row.retellCallId, err);
      }
    }

    if (Object.keys(patch).length === 0) {
      unresolved.push(row.retellCallId);
      continue;
    }

    await applyPatch(row.id, patch);
    fromEvents += 1;
  }

  return NextResponse.json({
    scanned: rows.length,
    fromEvents,
    fromRetell,
    unresolved: unresolved.length,
    // Las que no se pudieron resolver suelen ser web calls de prueba, que
    // legítimamente no tienen número de origen ni destino.
    unresolvedIds: unresolved.slice(0, 20),
  });
}

/**
 * Combina los payloads de una llamada y devuelve solo lo que hoy falta en la fila.
 */
function mergePatch(
  payloads: RetellCallShape[],
  current: {
    fromNumber: string | null;
    toNumber: string | null;
    startedAt: Date | null;
    endedAt: Date | null;
    durationSeconds: number | null;
  },
): MetadataPatch {
  const merged: RetellCallShape = {};
  for (const p of payloads) {
    if (!p || typeof p !== 'object') continue;
    if (p.from_number) merged.from_number = p.from_number;
    if (p.to_number) merged.to_number = p.to_number;
    if (p.start_timestamp) merged.start_timestamp = p.start_timestamp;
    if (p.end_timestamp) merged.end_timestamp = p.end_timestamp;
    if (p.duration_ms) merged.duration_ms = p.duration_ms;
    if (p.disconnection_reason) merged.disconnection_reason = p.disconnection_reason;
  }

  const patch: MetadataPatch = {};
  if (!current.fromNumber && merged.from_number) patch.fromNumber = merged.from_number;
  if (!current.toNumber && merged.to_number) patch.toNumber = merged.to_number;

  const start = merged.start_timestamp ? new Date(merged.start_timestamp) : null;
  const end = merged.end_timestamp ? new Date(merged.end_timestamp) : null;
  if (!current.startedAt && start) patch.startedAt = start;
  if (!current.endedAt && end) patch.endedAt = end;

  if (!current.durationSeconds) {
    if (start && end) {
      patch.durationSeconds = Math.round((end.getTime() - start.getTime()) / 1000);
    } else if (typeof merged.duration_ms === 'number') {
      patch.durationSeconds = Math.round(merged.duration_ms / 1000);
    }
  }

  if (merged.disconnection_reason === 'call_transfer') patch.transferred = true;

  return patch;
}

async function applyPatch(callId: string, patch: MetadataPatch) {
  await db.update(calls).set(patch).where(eq(calls.id, callId));
}

/**
 * GET: cuántas llamadas siguen incompletas (para decidir si mostrar el botón).
 */
export async function GET() {
  let tenantId: string;
  try {
    const ctx = await getCurrentTenant();
    tenantId = ctx.tenant.id;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(calls)
    .where(
      and(eq(calls.tenantId, tenantId), or(isNull(calls.startedAt), isNull(calls.durationSeconds))),
    );

  return NextResponse.json({ pending: row?.total ?? 0 });
}
