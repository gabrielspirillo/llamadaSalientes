import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { whatsappConversations } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { subscribe } from '@/lib/realtime/hub';
import { getCurrentTenantOrNull } from '@/lib/tenant';
import { conversationChannel } from '@/lib/whatsapp/realtime/events';

// SSE endpoint para empujar mensajes nuevos y eventos de typing del agente
// hacia el browser.
//
// Usa el hub compartido (lib/realtime/hub.ts): un único subscriber ioredis por
// proceso con refcount. Antes abría un cliente Redis NUEVO por conexión SSE, y
// con varias pestañas por operador × réplicas se agotaban las conexiones de
// Redis. El hub además rehace las suscripciones en el evento `ready`, que es
// lo que evita que un restart de Redis deje todas las SSE mudas.
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

  const channel = conversationChannel(conversationId);
  const encoder = new TextEncoder();

  // cancel() puede dispararse sin que se aborte req.signal, así que el cleanup
  // tiene que ser alcanzable desde fuera de start().
  let cleanup: () => void = () => undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let heartbeat: NodeJS.Timeout | null = null;
      let unsubscribe: (() => void) | null = null;

      cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        unsubscribe?.();
        unsubscribe = null;
        try {
          controller.close();
        } catch {
          /* ya cerrado del otro lado */
        }
      };

      // El listener se registra ANTES de cualquier await: si el browser
      // aborta durante el subscribe (recarga rápida, navegación), registrarlo
      // después dejaba el intervalo y la suscripción huérfanos para siempre.
      req.signal.addEventListener('abort', cleanup);
      if (req.signal.aborted) {
        cleanup();
        return;
      }

      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          cleanup();
        }
      };

      try {
        unsubscribe = await subscribe(channel, (payload) => {
          try {
            // La `kind` del evento se emite como event type y el JSON entero
            // como data.
            const parsedEvent = JSON.parse(payload) as { kind: string };
            safeEnqueue(encoder.encode(`event: ${parsedEvent.kind}\ndata: ${payload}\n\n`));
          } catch {
            // Payload malformado: ignorar.
          }
        });
      } catch (err) {
        console.error('[wa-stream] subscribe failed', {
          conversationId,
          err: (err as Error).message,
        });
        cleanup();
        return;
      }

      if (closed) {
        // Abortó mientras esperábamos el subscribe.
        unsubscribe?.();
        unsubscribe = null;
        return;
      }

      // Saludo inicial: confirma al EventSource que la conexión está viva.
      safeEnqueue(encoder.encode(`: connected ${Date.now()}\n\n`));

      heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(': ping\n\n'));
      }, HEARTBEAT_MS);
    },
    cancel() {
      cleanup();
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
