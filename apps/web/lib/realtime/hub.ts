import 'server-only';
import IORedis, { type Redis } from 'ioredis';

import { env } from '@/lib/env';

// Hub de suscripciones Redis compartido por proceso Node.
//
// Problema que resuelve: el stream SSE de WhatsApp abre un cliente ioredis
// NUEVO por conexión. Con el chat interno (una SSE permanente por usuario
// logueado) eso significa una conexión Redis por usuario y por réplica web.
// Acá hay UN solo subscriber por proceso, un `Map<canal, Set<Sink>>` y
// refcount: cuando el último sink de un canal se va, se hace UNSUBSCRIBE.
//
// Ojo con las réplicas: cada réplica de `cliniq-web` tiene su propio hub y su
// propia suscripción. Redis pub/sub hace broadcast a todas, así que funciona
// sin sticky sessions. Lo que NO puede vivir en memoria del proceso es la
// presencia (va a Redis, ver lib/messaging/publisher.ts).

export type Sink = (payload: string) => void;

const subs = new Map<string, Set<Sink>>();
let sub: Redis | null = null;

function ensureSubscriber(): Redis {
  if (sub) return sub;

  // Cliente DEDICADO: una conexión ioredis en subscriber mode no acepta otros
  // comandos, por eso no se reusa la de BullMQ (`lib/queue/connection`).
  const client = new IORedis(env.REDIS_URL as string, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    // Reconnect agresivo: si Redis se reinicia (redeploy de Dokploy) volvemos
    // a conectar en lugar de dejar las SSE mudas.
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });

  client.on('message', (channel: string, payload: string) => {
    const set = subs.get(channel);
    if (!set) return;
    for (const sink of set) {
      try {
        sink(payload);
      } catch {
        // Sink muerto (controller cerrado): lo limpia su propio unsubscribe.
      }
    }
  });

  client.on('error', (err: Error) => {
    console.warn('[realtime-hub] redis error', { err: err.message });
  });

  // CRÍTICO: Redis pierde TODAS las suscripciones al reconectar. Sin esto, un
  // redeploy de Redis deja las SSE vivas pero mudas para siempre.
  client.on('ready', () => {
    const channels = [...subs.keys()];
    if (channels.length === 0) return;
    client.subscribe(...channels).catch((err: Error) => {
      console.warn('[realtime-hub] resubscribe failed', {
        channels: channels.length,
        err: err.message,
      });
    });
  });

  sub = client;
  return client;
}

/**
 * Suscribe `sink` al canal Redis. Devuelve la función que lo desuscribe; si es
 * el último sink del canal, además hace UNSUBSCRIBE y borra la entrada del Map.
 *
 * Sin `REDIS_URL` devuelve un no-op en lugar de lanzar: la app tiene que poder
 * arrancar sin backend de tiempo real.
 */
export async function subscribe(channel: string, sink: Sink): Promise<() => void> {
  if (!env.REDIS_URL) return () => undefined;

  const client = ensureSubscriber();

  let set = subs.get(channel);
  const isFirst = !set;
  if (!set) {
    set = new Set();
    subs.set(channel, set);
  }
  // Se agrega ANTES del await para no perder mensajes que lleguen mientras el
  // SUBSCRIBE está en vuelo.
  set.add(sink);

  if (isFirst) {
    try {
      await client.subscribe(channel);
    } catch (err) {
      console.warn('[realtime-hub] subscribe failed', {
        channel,
        err: (err as Error).message,
      });
      // Se deja la entrada en el Map: el handler de `ready` va a reintentar
      // cuando la conexión vuelva.
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = subs.get(channel);
    if (!current) return;
    current.delete(sink);
    if (current.size === 0) {
      subs.delete(channel);
      client.unsubscribe(channel).catch(() => undefined);
    }
  };
}

/** Diagnóstico: cuántos canales y cuántos sinks vivos tiene este proceso. */
export function hubStats(): { channels: number; sinks: number } {
  let sinks = 0;
  for (const set of subs.values()) sinks += set.size;
  return { channels: subs.size, sinks };
}
