import 'server-only';
import { db } from '@/lib/db/client';
import { calls } from '@/lib/db/schema';
import { and, desc, eq, gte } from 'drizzle-orm';

export type Notification = {
  id: string;
  kind: 'agendar' | 'reagendar' | 'cancelar' | 'consulta' | 'queja' | 'transferida' | 'otro';
  title: string;
  detail: string;
  callId: string;
  createdAt: Date;
};

const KIND_TITLE: Record<string, string> = {
  agendar: 'Cita agendada',
  reagendar: 'Cita reagendada',
  cancelar: 'Cita cancelada',
  consulta: 'Consulta nueva',
  queja: 'Queja recibida',
  transferida: 'Llamada transferida',
  otro: 'Llamada nueva',
};

/**
 * Genera la lista de notificaciones leyendo las últimas N llamadas y
 * convirtiéndolas según su intent / transferencia. No es cola persistente —
 * derivamos en runtime para no agregar otra tabla.
 */
export async function listNotifications(tenantId: string, limit = 20): Promise<Notification[]> {
  // Últimas 7 días
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const rows = await db
    .select({
      id: calls.id,
      retellCallId: calls.retellCallId,
      intent: calls.intent,
      transferred: calls.transferred,
      summary: calls.summary,
      fromNumber: calls.fromNumber,
      toNumber: calls.toNumber,
      startedAt: calls.startedAt,
      customData: calls.customData,
    })
    .from(calls)
    .where(and(eq(calls.tenantId, tenantId), gte(calls.startedAt, since)))
    .orderBy(desc(calls.startedAt))
    .limit(limit);

  return rows
    .map<Notification | null>((c) => {
      const cd = (c.customData ?? {}) as { patient_name?: string };
      const isWeb = !c.fromNumber && !c.toNumber;
      const phone = c.fromNumber ?? c.toNumber ?? null;
      const who = cd.patient_name ?? phone ?? (isWeb ? 'Prueba desde el panel' : 'Llamada anónima');
      const startedAt = c.startedAt ?? new Date();

      let kind: Notification['kind'];
      if (c.transferred) kind = 'transferida';
      else if (c.intent === 'agendar') kind = 'agendar';
      else if (c.intent === 'reagendar') kind = 'reagendar';
      else if (c.intent === 'cancelar') kind = 'cancelar';
      else if (c.intent === 'consulta' || c.intent === 'pregunta') kind = 'consulta';
      else if (c.intent === 'queja') kind = 'queja';
      else kind = 'otro';

      // Detail: nombre + resumen corto (o motivo si no hay resumen aún)
      const summarySnippet = c.summary?.trim();
      const detailRight = summarySnippet
        ? summarySnippet.slice(0, 90) + (summarySnippet.length > 90 ? '…' : '')
        : c.intent
          ? `Motivo: ${c.intent}`
          : 'Procesando resumen…';

      return {
        id: c.id,
        kind,
        title: KIND_TITLE[kind] ?? 'Llamada',
        detail: `${who} · ${detailRight}`,
        callId: c.id,
        createdAt: startedAt,
      };
    })
    .filter((n): n is Notification => n !== null);
}
