import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import { db } from '@/lib/db/client';
import { imChannelMembers, imUserSettings } from '@/lib/db/schema';
import { PRESENCE_TTL_SECONDS, TYPING_TTL_SECONDS } from '@/lib/messaging/constants';
import {
  type ImRealtimeEvent,
  presenceKey,
  tenantChannel,
  typingKey,
  userChannel,
} from '@/lib/messaging/events';
import type { ImPresence } from '@/lib/messaging/types';

// Publicación de eventos del módulo Mensajes a Redis pub/sub. El SSE
// multiplexado (`/api/messages/stream`) está SUBSCRIBE-ado al canal personal de
// cada usuario y reenvía al browser.
//
// Fan-out en la ESCRITURA: se publica una copia por miembro a `im:user:<id>`.
// Así cada SSE mantiene una sola suscripción fija durante toda la sesión, sin
// re-suscribirse cada vez que alguien entra o sale de un canal. El coste es un
// PUBLISH por miembro, que se resuelve con un `pipeline()`.
//
// Comparte conexión con BullMQ vía getRedis(): PUBLISH, SETEX, DEL y MGET son
// comandos regulares (no entran en subscriber mode) así que es seguro.
//
// TODO acá es best-effort: si Redis está caído o la migración `im_` todavía no
// se aplicó, se loguea y se sigue. NUNCA se lanza hacia arriba.

async function getClient(): Promise<Redis | null> {
  if (!process.env.REDIS_URL) return null;
  try {
    // Import dinámico para no arrastrar la validación de `lib/env.ts` en
    // archivos que se cargan desde tests sin vars completas.
    const { getRedis } = await import('@/lib/queue/connection');
    return getRedis();
  } catch (err) {
    console.warn('[im-realtime] no hay cliente Redis', { err: (err as Error).message });
    return null;
  }
}

/**
 * Un PUBLISH por usuario, todos en el mismo pipeline (un solo round-trip).
 */
export async function publishToUsers(userIds: string[], event: ImRealtimeEvent): Promise<void> {
  if (userIds.length === 0) return;
  try {
    const redis = await getClient();
    if (!redis) return;
    const payload = JSON.stringify(event);
    const pipeline = redis.pipeline();
    // Set para no duplicar si el llamador pasó ids repetidos.
    for (const userId of new Set(userIds)) {
      pipeline.publish(userChannel(userId), payload);
    }
    await pipeline.exec();
  } catch (err) {
    console.warn('[im-realtime] publishToUsers falló', {
      kind: event.kind,
      users: userIds.length,
      err: (err as Error).message,
    });
  }
}

/** Publica al canal de tenant: presencia y cambios que ve todo el mundo. */
export async function publishToTenant(tenantId: string, event: ImRealtimeEvent): Promise<void> {
  try {
    const redis = await getClient();
    if (!redis) return;
    await redis.publish(tenantChannel(tenantId), JSON.stringify(event));
  } catch (err) {
    console.warn('[im-realtime] publishToTenant falló', {
      kind: event.kind,
      err: (err as Error).message,
    });
  }
}

/** Miembros activos del canal (los que no se fueron). */
async function activeMemberIds(tenantId: string, channelId: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ userId: imChannelMembers.userId })
      .from(imChannelMembers)
      .where(
        and(
          eq(imChannelMembers.tenantId, tenantId),
          eq(imChannelMembers.channelId, channelId),
          isNull(imChannelMembers.leftAt),
        ),
      );
    return rows.map((r) => r.userId);
  } catch (err) {
    console.warn('[im-realtime] no se pudieron leer los miembros del canal', {
      channelId,
      err: (err as Error).message,
    });
    return [];
  }
}

/**
 * Fan-out a los miembros del canal. `exceptUserId` sirve para no devolverle al
 * autor su propio eco (typing, y el envío optimista del cliente).
 */
export async function publishToChannelMembers(
  tenantId: string,
  channelId: string,
  event: ImRealtimeEvent,
  exceptUserId?: string | null,
): Promise<void> {
  const members = await activeMemberIds(tenantId, channelId);
  const targets = exceptUserId ? members.filter((id) => id !== exceptUserId) : members;
  await publishToUsers(targets, event);
}

/**
 * "Está escribiendo…". Estado efímero: vive en Redis con TTL corto y se publica
 * al resto del canal. Escribirlo en Postgres sería un UPDATE por pulsación.
 */
export async function publishTyping(a: {
  tenantId: string;
  channelId: string;
  userId: string;
  name: string;
  stop?: boolean;
}): Promise<void> {
  try {
    const redis = await getClient();
    if (redis) {
      const key = typingKey(a.channelId, a.userId);
      if (a.stop) {
        await redis.del(key);
      } else {
        await redis.setex(key, TYPING_TTL_SECONDS, a.name);
      }
    }
  } catch (err) {
    console.warn('[im-realtime] typing key falló', {
      channelId: a.channelId,
      err: (err as Error).message,
    });
  }

  const event: ImRealtimeEvent = a.stop
    ? { kind: 'typing.stop', channelId: a.channelId, userId: a.userId }
    : { kind: 'typing.start', channelId: a.channelId, userId: a.userId, name: a.name };

  await publishToChannelMembers(a.tenantId, a.channelId, event, a.userId);
}

/**
 * Heartbeat de presencia. Lo llama la SSE cada 20 s: la conexión viva ES la
 * señal de presencia, no hace falta que el cliente reporte nada.
 */
export async function touchPresence(tenantId: string, userId: string): Promise<void> {
  try {
    const redis = await getClient();
    if (!redis) return;
    await redis.setex(presenceKey(tenantId, userId), PRESENCE_TTL_SECONDS, '1');
  } catch (err) {
    console.warn('[im-realtime] touchPresence falló', { userId, err: (err as Error).message });
  }
}

/** Borra la marca de presencia (cierre limpio de la SSE). */
export async function clearPresence(tenantId: string, userId: string): Promise<void> {
  try {
    const redis = await getClient();
    if (!redis) return;
    await redis.del(presenceKey(tenantId, userId));
  } catch (err) {
    console.warn('[im-realtime] clearPresence falló', { userId, err: (err as Error).message });
  }
}

/**
 * Presencia + estado personalizado de un puñado de usuarios, en un MGET y una
 * query. Sin Redis todos figuran offline, pero el estado (emoji/texto) igual se
 * devuelve: vive en Postgres.
 */
export async function readPresence(tenantId: string, userIds: string[]): Promise<ImPresence[]> {
  if (userIds.length === 0) return [];
  const ids = [...new Set(userIds)];

  // 1. Online: un MGET de todas las claves.
  const online = new Map<string, boolean>(ids.map((id) => [id, false]));
  try {
    const redis = await getClient();
    if (redis) {
      const values = await redis.mget(...ids.map((id) => presenceKey(tenantId, id)));
      ids.forEach((id, i) => online.set(id, values[i] != null));
    }
  } catch (err) {
    console.warn('[im-realtime] readPresence falló', { err: (err as Error).message });
  }

  // 2. Estado personalizado. `statusUntil` vencido == sin estado.
  const status = new Map<string, { emoji: string | null; text: string | null }>();
  try {
    const rows = await db
      .select({
        userId: imUserSettings.userId,
        statusEmoji: imUserSettings.statusEmoji,
        statusText: imUserSettings.statusText,
        statusUntil: imUserSettings.statusUntil,
      })
      .from(imUserSettings)
      .where(and(eq(imUserSettings.tenantId, tenantId), inArray(imUserSettings.userId, ids)));

    const now = Date.now();
    for (const row of rows) {
      const expired = row.statusUntil != null && row.statusUntil.getTime() <= now;
      status.set(row.userId, {
        emoji: expired ? null : (row.statusEmoji ?? null),
        text: expired ? null : (row.statusText ?? null),
      });
    }
  } catch (err) {
    console.warn('[im-realtime] no se pudo leer im_user_settings', {
      err: (err as Error).message,
    });
  }

  return ids.map((userId) => ({
    userId,
    online: online.get(userId) ?? false,
    statusEmoji: status.get(userId)?.emoji ?? null,
    statusText: status.get(userId)?.text ?? null,
  }));
}
