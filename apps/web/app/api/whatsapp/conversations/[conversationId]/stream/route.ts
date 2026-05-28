import IORedis from 'ioredis';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { whatsappConversations } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { getCurrentTenantOrNull } from '@/lib/tenant';
import { conversationChannel } from '@/lib/whatsapp/realtime/events';

// SSE endpoint para empujar mensajes nuevos y eventos de typing del agente
// hacia el browser. Se conecta a Redis pub/sub con un cliente DEDICADO
// (ioredis no permite mezclar SUBSCRIBE con otros comandos en la misma
// conexión) y forwardea cada mensaje recibido al stream.
//
// Esto NO puede ser Edge runtime: necesitamos ioredis con TCP raw.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ conversationId: z.string().uuid() });

// 15s. Suficiente para mantener vivos proxies (Traefik default idle ~60s)
// sin sobrecargar el server.
const HEARTBEAT_MS = 15_000;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return new Response('Bad conversationId', { status: 400 });
  }
  const { conversationId } = parsed.data;

  // Auth + tenant ownership.
  const tenantCtx = await getCurrentTenantOrNull();
  if (!tenantCtx) {
    return new Response('Unauthorized', { status: 401 });
  }
  const ownsConv = await db
    .select({ id: whatsappConversations.id })
    .from(whatsappConversations)
    .where(
      and(
        eq(whatsappConversations.id, conversationId),
        eq(whatsappConversations.tenantId, tenantCtx.tenant.id),
      ),
    )
    .limit(1);
  if (ownsConv.length === 0) {
    return new Response('Not found', { status: 404 });
  }

  if (!env.REDIS_URL) {
    return new Response('Realtime backend unavailable', { status: 503 });
  }
  const redisUrl = env.REDIS_URL;

  const channel = conversationChannel(conversationId);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let heartbeat: NodeJS.Timeout | null = null;

      // Cliente ioredis dedicado para esta conexión SSE: una vez que entra en
      // subscriber mode no acepta otros comandos, por eso no reusamos el de
      // BullMQ.
      const subscriber = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        retryStrategy: (times) => Math.min(times * 200, 5000),
      });

      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          // Ya cerrado del otro lado: marcar y limpiar.
          closed = true;
          cleanup();
        }
      };

      const cleanup = () => {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        // unsubscribe + quit: no propagar errores.
        subscriber.unsubscribe(channel).catch(() => undefined);
        subscriber.quit().catch(() => undefined);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* noop */
          }
        }
      };

      subscriber.on('message', (_ch, payload) => {
        // Parseamos para extraer la kind y emitirla como event type, y
        // reemitimos el JSON entero como data.
        try {
          const parsedEvent = JSON.parse(payload) as { kind: string };
          const eventName = parsedEvent.kind;
          const data =
            `event: ${eventName}\n` +
            `data: ${payload}\n\n`;
          safeEnqueue(encoder.encode(data));
        } catch {
          // Payload malformed: ignorar.
        }
      });

      subscriber.on('error', (err) => {
        console.warn('[wa-stream] redis subscriber error', {
          conversationId,
          err: err.message,
        });
      });

      try {
        await subscriber.subscribe(channel);
      } catch (err) {
        console.error('[wa-stream] subscribe failed', {
          conversationId,
          err: (err as Error).message,
        });
        cleanup();
        return;
      }

      // Saludo inicial: confirma al EventSource que la conexión está viva.
      safeEnqueue(encoder.encode(`: connected ${Date.now()}\n\n`));

      heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(`: ping\n\n`));
      }, HEARTBEAT_MS);

      req.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Anti-buffering de Nginx/Traefik en caso de que algún proxy lo respete.
      'X-Accel-Buffering': 'no',
    },
  });
}
