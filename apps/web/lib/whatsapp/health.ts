import 'server-only';
import { and, desc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { auditLogs, whatsappConnections } from '@/lib/db/schema';
import {
  ALERT_COOLDOWN_MS,
  type ChannelProblem,
  type ChannelRow,
  UNSTABLE_RECONNECTS_24H,
  channelProblem,
  channelProblemText,
  inboundLagMs,
  isLagged,
  receivingSince,
} from '@/lib/whatsapp/health-model';

/**
 * Salud del canal de WhatsApp de cada clínica. Lo puro está en
 * `health-model.ts`; aquí se lee y se escribe. Nada de esto lanza: un fallo al
 * medir la salud no puede romper la recepción de un mensaje.
 */

/** La conexión que usa la clínica (la más reciente, conectada o no). */
async function currentConnection(tenantId: string) {
  const [row] = await db
    .select({
      id: whatsappConnections.id,
      mode: whatsappConnections.mode,
      status: whatsappConnections.status,
      lastFreshInboundAt: whatsappConnections.lastFreshInboundAt,
      lastLaggedInboundAt: whatsappConnections.lastLaggedInboundAt,
      lastInboundLagSeconds: whatsappConnections.lastInboundLagSeconds,
      healthAlertedAt: whatsappConnections.healthAlertedAt,
    })
    .from(whatsappConnections)
    .where(eq(whatsappConnections.tenantId, tenantId))
    // Conectada primero; entre iguales, la tocada más recientemente.
    .orderBy(
      sql`case when ${whatsappConnections.status} = 'CONNECTED' then 0 else 1 end`,
      desc(whatsappConnections.updatedAt),
    )
    .limit(1);
  return row ?? null;
}

function asChannelRow(row: Awaited<ReturnType<typeof currentConnection>>): ChannelRow | null {
  return row
    ? {
        mode: row.mode,
        status: row.status,
        lastFreshInboundAt: row.lastFreshInboundAt,
        lastLaggedInboundAt: row.lastLaggedInboundAt,
      }
    : null;
}

/** Problema del canal ahora mismo, o null si está sano. Ante un error, null. */
export async function getChannelProblem(tenantId: string): Promise<ChannelProblem | null> {
  try {
    return channelProblem(asChannelRow(await currentConnection(tenantId)), new Date());
  } catch (err) {
    console.warn('[wa-health] no se pudo leer la salud del canal', (err as Error).message);
    return null;
  }
}

/**
 * ¿Hay prueba de que el canal recibe desde `since`? Ante un error, false: es la
 * condición para anular una cita y en la duda no se anula.
 */
export async function isReceivingSince(tenantId: string, since: Date): Promise<boolean> {
  try {
    return receivingSince(asChannelRow(await currentConnection(tenantId)), since, new Date());
  } catch (err) {
    console.warn('[wa-health] no se pudo comprobar la recepción', (err as Error).message);
    return false;
  }
}

/**
 * Lo llama el webhook de Evolution con cada entrante (también los ecos del
 * teléfono de la clínica, que sufren el mismo retraso). Marca la conexión como
 * sana o con retraso y, si es lo segundo, avisa al equipo.
 */
export async function noteInboundTiming(args: {
  tenantId: string;
  connectionId: string;
  writtenAt: Date | null | undefined;
  receivedAt?: Date;
}): Promise<void> {
  try {
    const now = args.receivedAt ?? new Date();
    const lag = inboundLagMs(args.writtenAt, now);
    if (lag === null) return;
    if (!isLagged(lag)) {
      // Un UPDATE por minuto como mucho: con una ráfaga no hace falta más.
      await db
        .update(whatsappConnections)
        .set({ lastFreshInboundAt: now })
        .where(
          and(
            eq(whatsappConnections.id, args.connectionId),
            eq(whatsappConnections.tenantId, args.tenantId),
            or(
              isNull(whatsappConnections.lastFreshInboundAt),
              lt(whatsappConnections.lastFreshInboundAt, new Date(now.getTime() - 60_000)),
            ),
          ),
        );
      return;
    }
    const lagMinutes = Math.round(lag / 60_000);
    await db
      .update(whatsappConnections)
      .set({ lastLaggedInboundAt: now, lastInboundLagSeconds: Math.round(lag / 1000) })
      .where(
        and(
          eq(whatsappConnections.id, args.connectionId),
          eq(whatsappConnections.tenantId, args.tenantId),
        ),
      );
    console.warn('[wa-health] entrante con retraso', {
      tenantId: args.tenantId,
      lagMinutes,
    });
    await alertChannelProblem({
      tenantId: args.tenantId,
      connectionId: args.connectionId,
      problem: 'DELAYED',
      lagMinutes,
    });
  } catch (err) {
    console.warn('[wa-health] noteInboundTiming falló', (err as Error).message);
  }
}

/**
 * Cambio de estado de la conexión. Al desconectarse se avisa en el acto; al
 * reconectarse se cuentan las reconexiones del día: una sesión que reconecta
 * cada pocos minutos está a punto de dejar de recibir (pasó desde el 6/11
 * con 20-30 reconexiones diarias, cinco días antes de la caída).
 */
export async function noteConnectionState(args: {
  tenantId: string;
  connectionId: string;
  state: 'PENDING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
}): Promise<void> {
  try {
    if (args.state === 'DISCONNECTED' || args.state === 'ERROR') {
      await alertChannelProblem({
        tenantId: args.tenantId,
        connectionId: args.connectionId,
        problem: 'DISCONNECTED',
        force: true,
      });
      return;
    }
    if (args.state !== 'PENDING') return;
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, args.tenantId),
          eq(auditLogs.action, 'wa_evolution_connection_update'),
          gte(auditLogs.createdAt, since),
          sql`${auditLogs.after}->>'mapped' = 'PENDING'`,
        ),
      );
    const reconnects = row?.n ?? 0;
    if (reconnects < UNSTABLE_RECONNECTS_24H) return;
    await alertChannelProblem({
      tenantId: args.tenantId,
      connectionId: args.connectionId,
      problem: 'UNSTABLE',
      reconnects,
    });
  } catch (err) {
    console.warn('[wa-health] noteConnectionState falló', (err as Error).message);
  }
}

/**
 * Tarjeta en #urgencias (y log). Un aviso por canal cada `ALERT_COOLDOWN_MS`,
 * salvo `force` (una desconexión se avisa siempre, con su propia clave de
 * deduplicación por hora).
 */
async function alertChannelProblem(args: {
  tenantId: string;
  connectionId: string;
  problem: ChannelProblem | 'UNSTABLE';
  lagMinutes?: number;
  reconnects?: number;
  force?: boolean;
}): Promise<void> {
  const now = new Date();
  if (!args.force) {
    const claimed = await db
      .update(whatsappConnections)
      .set({ healthAlertedAt: now })
      .where(
        and(
          eq(whatsappConnections.id, args.connectionId),
          eq(whatsappConnections.tenantId, args.tenantId),
          or(
            isNull(whatsappConnections.healthAlertedAt),
            lt(whatsappConnections.healthAlertedAt, new Date(now.getTime() - ALERT_COOLDOWN_MS)),
          ),
        ),
      )
      .returning({ id: whatsappConnections.id });
    if (!claimed.length) return;
  }
  const body =
    args.problem === 'UNSTABLE'
      ? `La conexión de WhatsApp se ha reiniciado ${args.reconnects} veces en las últimas 24 h. Suele ser la señal previa a que deje de recibir mensajes. Conviene desvincular y volver a vincular el WhatsApp (escanear el QR) en un momento tranquilo.`
      : channelProblemText(args.problem, args.lagMinutes);
  const title =
    args.problem === 'DISCONNECTED'
      ? 'WhatsApp desconectado'
      : args.problem === 'DELAYED'
        ? 'WhatsApp recibe con retraso'
        : 'WhatsApp inestable';
  const { postSystemEvent } = await import('@/lib/messaging/bot');
  await postSystemEvent({
    tenantId: args.tenantId,
    event: 'wa.channel_problem',
    title,
    body,
    actions: [
      {
        id: 'open-wa-integrations',
        label: 'Abrir integraciones',
        tone: 'primary',
        href: '/dashboard/whatsapp/integrations',
      },
    ],
    dedupeKey: `evt:wa.channel_problem:${args.tenantId}:${args.problem}:${now
      .toISOString()
      .slice(0, 13)}`,
  });
}
