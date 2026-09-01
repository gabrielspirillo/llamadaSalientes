import { env } from '@/lib/env';
import { requireMessagingRole } from '@/lib/messaging/auth';
import { tenantChannel, userChannel } from '@/lib/messaging/events';
import { clearPresence, publishToTenant, touchPresence } from '@/lib/messaging/publisher';
import { subscribe } from '@/lib/realtime/hub';

// SSE multiplexado del módulo Mensajes: UNA sola conexión por usuario para
// todos sus canales. Se suscribe (vía el hub compartido) a su canal personal
// `im:user:<id>` — donde caen los eventos con fan-out en escritura — y al canal
// de tenant `im:tenant:<id>`, por donde viaja la presencia.
//
// No puede ser Edge runtime: el hub usa ioredis con TCP raw.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 15 s: mantiene vivos los proxies (idle default de Traefik ~60 s) sin
// sobrecargar el server.
const HEARTBEAT_MS = 15_000;

// 20 s contra un TTL de presencia de 45 s: aguanta un latido perdido antes de
// marcar a la persona como desconectada.
const PRESENCE_MS = 20_000;

export async function GET(req: Request): Promise<Response> {
  let auth;
  try {
    auth = await requireMessagingRole('viewer');
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const { tenantId } = auth;

  // `requireMessagingRole` ya resuelve el users.id interno. El fallback existe
  // por si el join no lo trajo; el import es dinámico para no acoplar el stream
  // al módulo de queries.
  let userId = auth.userId;
  if (!userId) {
    try {
      const { internalUserIdFor } = await import('@/lib/messaging/queries');
      userId = (await internalUserIdFor(auth.clerkUserId)) ?? '';
    } catch {
      /* queries todavía no disponible: se cae al 401 de abajo */
    }
  }
  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!env.REDIS_URL) {
    return new Response('Realtime backend unavailable', { status: 503 });
  }

  const encoder = new TextEncoder();

  // cancel() puede dispararse sin abortar req.signal; sin esto quedarían vivos
  // el heartbeat, el tick de presencia y las dos suscripciones del hub.
  let cleanup: () => void = () => undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let heartbeat: NodeJS.Timeout | null = null;
      let presenceTick: NodeJS.Timeout | null = null;
      let unsubUser: (() => void) | null = null;
      let unsubTenant: (() => void) | null = null;

      cleanup = () => {
        if (closed) return;
        closed = true;

        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (presenceTick) {
          clearInterval(presenceTick);
          presenceTick = null;
        }

        unsubUser?.();
        unsubUser = null;
        unsubTenant?.();
        unsubTenant = null;

        // Al irse: se borra la marca de presencia y se avisa al tenant.
        void clearPresence(tenantId, userId);
        void publishToTenant(tenantId, {
          kind: 'presence.changed',
          presence: { userId, online: false, statusEmoji: null, statusText: null },
        });

        try {
          controller.close();
        } catch {
          /* ya cerrado del otro lado */
        }
      };

      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          // El browser cortó: limpiar todo.
          cleanup();
        }
      };

      // El `kind` del payload se usa como nombre del `event:` de SSE y el JSON
      // entero va como `data:` — misma convención que el stream de WhatsApp.
      const forward = (payload: string) => {
        try {
          const { kind } = JSON.parse(payload) as { kind?: string };
          if (!kind) return;
          safeEnqueue(encoder.encode(`event: ${kind}\ndata: ${payload}\n\n`));
        } catch {
          // Payload malformado: ignorar.
        }
      };

      // Si el cliente aborta mientras los SUBSCRIBE están en vuelo, `cleanup`
      // corre con las funciones de desuscripción todavía en null; por eso abajo
      // se vuelve a chequear `closed`.
      req.signal.addEventListener('abort', cleanup);
      if (req.signal.aborted) {
        cleanup();
        return;
      }

      unsubUser = await subscribe(userChannel(userId), forward);
      unsubTenant = await subscribe(tenantChannel(tenantId), forward);
      if (closed) {
        unsubUser?.();
        unsubTenant?.();
        return;
      }

      // La SSE viva ES la señal de presencia: no hace falta que el cliente
      // reporte nada.
      void touchPresence(tenantId, userId);
      void publishToTenant(tenantId, {
        kind: 'presence.changed',
        presence: { userId, online: true, statusEmoji: null, statusText: null },
      });

      // Saludo inicial: confirma al EventSource que la conexión está viva.
      safeEnqueue(encoder.encode(`: connected ${Date.now()}\n\n`));

      heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(': ping\n\n'));
      }, HEARTBEAT_MS);

      presenceTick = setInterval(() => {
        void touchPresence(tenantId, userId);
      }, PRESENCE_MS);
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
      // Anti-buffering por si algún proxy lo respeta.
      'X-Accel-Buffering': 'no',
    },
  });
}
