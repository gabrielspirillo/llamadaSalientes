import { env } from '@/lib/env';
import { subscribe } from '@/lib/realtime/hub';
import { getCurrentTenantOrNull } from '@/lib/tenant';
import { tenantInboxChannel } from '@/lib/whatsapp/realtime/events';

// SSE del BUZÓN: empuja un aviso cada vez que cualquier conversación del tenant
// cambia (mensaje entrante o saliente), para que la lista se refresque al
// instante en vez de esperar al poll. No lleva el mensaje entero: el cliente
// hace router.refresh() y el server component vuelve a leer con el aislamiento
// por tenant. Mismo patrón que el stream de conversación.
//
// Nodejs runtime: el hub usa ioredis con TCP raw.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 15_000;

export async function GET(req: Request): Promise<Response> {
  const tenantCtx = await getCurrentTenantOrNull();
  if (!tenantCtx) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!env.REDIS_URL) {
    return new Response('Realtime backend unavailable', { status: 503 });
  }

  const channel = tenantInboxChannel(tenantCtx.tenant.id);
  const encoder = new TextEncoder();

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
            const parsedEvent = JSON.parse(payload) as { kind: string };
            safeEnqueue(encoder.encode(`event: ${parsedEvent.kind}\ndata: ${payload}\n\n`));
          } catch {
            /* payload malformado: ignorar */
          }
        });
      } catch (err) {
        console.error('[wa-inbox-stream] subscribe failed', {
          tenantId: tenantCtx.tenant.id,
          err: (err as Error).message,
        });
        cleanup();
        return;
      }

      if (closed) {
        unsubscribe?.();
        unsubscribe = null;
        return;
      }

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
      'X-Accel-Buffering': 'no',
    },
  });
}
