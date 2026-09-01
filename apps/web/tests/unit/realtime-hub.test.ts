import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Hub de suscripciones Redis compartido por proceso.
//
// Lo que se prueba acá no es ioredis: es el refcount y, sobre todo, la
// RE-SUSCRIPCIÓN tras el evento `ready`. Redis pierde todas las suscripciones
// al reconectar; sin ese handler, un redeploy del contenedor de Redis deja
// todas las conexiones SSE abiertas pero mudas para siempre, y nadie se entera
// porque el navegador sigue viendo la conexión viva.

const h = vi.hoisted(() => {
  class FakeRedis {
    static instances: FakeRedis[] = [];

    handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    /** Cada llamada a subscribe(), con sus canales. */
    subscribeCalls: string[][] = [];
    unsubscribeCalls: string[][] = [];
    subscribeRejects = false;

    constructor(
      public url: string,
      public opts: Record<string, unknown>,
    ) {
      FakeRedis.instances.push(this);
    }

    on(event: string, fn: (...args: unknown[]) => void): this {
      const list = this.handlers.get(event) ?? [];
      list.push(fn);
      this.handlers.set(event, list);
      return this;
    }

    /** Dispara un evento del cliente ioredis (message, ready, error…). */
    emit(event: string, ...args: unknown[]): void {
      for (const fn of this.handlers.get(event) ?? []) fn(...args);
    }

    async subscribe(...channels: string[]): Promise<number> {
      this.subscribeCalls.push(channels);
      if (this.subscribeRejects) throw new Error('redis caído');
      return channels.length;
    }

    async unsubscribe(...channels: string[]): Promise<number> {
      this.unsubscribeCalls.push(channels);
      return channels.length;
    }
  }

  return {
    FakeRedis,
    env: { REDIS_URL: 'redis://localhost:6379' } as { REDIS_URL?: string },
  };
});

vi.mock('ioredis', () => ({ default: h.FakeRedis, Redis: h.FakeRedis }));
vi.mock('@/lib/env', () => ({ env: h.env }));

type Hub = typeof import('@/lib/realtime/hub');

let hub: Hub;

/** El hub guarda estado a nivel de módulo; cada test arranca con uno limpio. */
async function freshHub(): Promise<Hub> {
  vi.resetModules();
  h.FakeRedis.instances.length = 0;
  return import('@/lib/realtime/hub');
}

function client(): InstanceType<typeof h.FakeRedis> {
  const [c] = h.FakeRedis.instances;
  if (!c) throw new Error('no se creó ningún cliente ioredis');
  return c;
}

/** Canales sobre los que hay un SUBSCRIBE efectivo, aplanados. */
function subscribed(): string[] {
  return client().subscribeCalls.flat();
}

beforeEach(async () => {
  h.env.REDIS_URL = 'redis://localhost:6379';
  vi.restoreAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  hub = await freshHub();
});

describe('refcount de suscripciones', () => {
  it('dos sinks en el MISMO canal producen un solo SUBSCRIBE', async () => {
    await hub.subscribe('im:user:1', () => undefined);
    await hub.subscribe('im:user:1', () => undefined);

    expect(client().subscribeCalls).toEqual([['im:user:1']]);
    expect(hub.hubStats()).toEqual({ channels: 1, sinks: 2 });
  });

  it('canales distintos producen un SUBSCRIBE cada uno, sobre UN solo cliente', async () => {
    await hub.subscribe('im:user:1', () => undefined);
    await hub.subscribe('im:tenant:t1', () => undefined);

    expect(h.FakeRedis.instances).toHaveLength(1);
    expect(subscribed()).toEqual(['im:user:1', 'im:tenant:t1']);
  });

  it('desuscribir uno de dos NO hace UNSUBSCRIBE', async () => {
    const off1 = await hub.subscribe('im:user:1', () => undefined);
    await hub.subscribe('im:user:1', () => undefined);

    off1();

    expect(client().unsubscribeCalls).toEqual([]);
    expect(hub.hubStats()).toEqual({ channels: 1, sinks: 1 });
  });

  it('desuscribir el ÚLTIMO sí hace UNSUBSCRIBE y limpia el canal', async () => {
    const off1 = await hub.subscribe('im:user:1', () => undefined);
    const off2 = await hub.subscribe('im:user:1', () => undefined);

    off1();
    off2();

    expect(client().unsubscribeCalls).toEqual([['im:user:1']]);
    expect(hub.hubStats()).toEqual({ channels: 0, sinks: 0 });
  });

  it('llamar dos veces a la misma función de desuscripción es inocuo', async () => {
    const off = await hub.subscribe('im:user:1', () => undefined);
    await hub.subscribe('im:user:1', () => undefined);

    off();
    off();
    off();

    // El segundo sink sigue vivo: la desuscripción repetida no se lo llevó.
    expect(hub.hubStats()).toEqual({ channels: 1, sinks: 1 });
    expect(client().unsubscribeCalls).toEqual([]);
  });

  // El refcount se lleva en un Set<Sink>, así que la MISMA referencia de función
  // suscrita dos veces al mismo canal cuenta una sola vez. Hoy ningún llamador
  // hace eso (el stream SSE pasa el mismo `forward` a dos canales DISTINTOS, que
  // son Sets distintos), pero si alguien lo hiciera, la primera desuscripción se
  // llevaría también a la segunda. Queda documentado.
  it('la misma referencia de sink cuenta una sola vez en el mismo canal', async () => {
    const sink = vi.fn();
    const off1 = await hub.subscribe('im:user:1', sink);
    await hub.subscribe('im:user:1', sink);

    expect(hub.hubStats()).toEqual({ channels: 1, sinks: 1 });

    off1();
    expect(hub.hubStats()).toEqual({ channels: 0, sinks: 0 });
  });

  it('el mismo sink en canales distintos se cuenta por separado', async () => {
    const sink = vi.fn();
    const offUser = await hub.subscribe('im:user:1', sink);
    await hub.subscribe('im:tenant:t1', sink);

    offUser();

    expect(hub.hubStats()).toEqual({ channels: 1, sinks: 1 });
    client().emit('message', 'im:tenant:t1', 'presencia');
    expect(sink).toHaveBeenCalledWith('presencia');
  });

  it('volver a suscribirse a un canal ya liberado hace un SUBSCRIBE nuevo', async () => {
    const off = await hub.subscribe('im:user:1', () => undefined);
    off();
    await hub.subscribe('im:user:1', () => undefined);

    expect(client().subscribeCalls).toEqual([['im:user:1'], ['im:user:1']]);
  });
});

describe('entrega de mensajes', () => {
  it('un mensaje entrante llega a todos los sinks del canal', async () => {
    const a = vi.fn();
    const b = vi.fn();
    await hub.subscribe('im:user:1', a);
    await hub.subscribe('im:user:1', b);

    client().emit('message', 'im:user:1', '{"kind":"message.new"}');

    expect(a).toHaveBeenCalledWith('{"kind":"message.new"}');
    expect(b).toHaveBeenCalledWith('{"kind":"message.new"}');
  });

  it('no cruza mensajes entre canales', async () => {
    const mio = vi.fn();
    const ajeno = vi.fn();
    await hub.subscribe('im:user:1', mio);
    await hub.subscribe('im:user:2', ajeno);

    client().emit('message', 'im:user:1', 'hola');

    expect(mio).toHaveBeenCalledTimes(1);
    expect(ajeno).not.toHaveBeenCalled();
  });

  it('un sink que lanza no impide que los demás reciban', async () => {
    const explota = vi.fn(() => {
      throw new Error('controller cerrado');
    });
    const sano1 = vi.fn();
    const sano2 = vi.fn();

    // El que explota va PRIMERO: si el for no atrapara, los otros dos se
    // quedarían sin el mensaje.
    await hub.subscribe('im:user:1', explota);
    await hub.subscribe('im:user:1', sano1);
    await hub.subscribe('im:user:1', sano2);

    expect(() => client().emit('message', 'im:user:1', 'payload')).not.toThrow();
    expect(sano1).toHaveBeenCalledWith('payload');
    expect(sano2).toHaveBeenCalledWith('payload');
  });

  it('un mensaje de un canal sin sinks no rompe nada', async () => {
    await hub.subscribe('im:user:1', () => undefined);
    expect(() => client().emit('message', 'im:user:9', 'payload')).not.toThrow();
  });

  it('un sink desuscrito ya no recibe', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = await hub.subscribe('im:user:1', a);
    await hub.subscribe('im:user:1', b);

    offA();
    client().emit('message', 'im:user:1', 'payload');

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe('reconexión (evento ready)', () => {
  // ESTE es el test que sostiene el módulo en producción.
  it('tras `ready` se rehacen las suscripciones de todos los canales vivos', async () => {
    await hub.subscribe('im:user:1', () => undefined);
    await hub.subscribe('im:user:2', () => undefined);
    await hub.subscribe('im:tenant:t1', () => undefined);

    const c = client();
    c.subscribeCalls.length = 0; // sólo nos interesa lo que pasa DESPUÉS

    c.emit('ready');

    expect(c.subscribeCalls).toHaveLength(1);
    expect([...c.subscribeCalls[0]!].sort()).toEqual(['im:tenant:t1', 'im:user:1', 'im:user:2']);
  });

  it('los sinks siguen recibiendo después de la reconexión', async () => {
    const sink = vi.fn();
    await hub.subscribe('im:user:1', sink);

    client().emit('ready');
    client().emit('message', 'im:user:1', 'después del redeploy');

    expect(sink).toHaveBeenCalledWith('después del redeploy');
  });

  it('sin canales vivos, `ready` no manda ningún SUBSCRIBE', async () => {
    const off = await hub.subscribe('im:user:1', () => undefined);
    off();

    const c = client();
    c.subscribeCalls.length = 0;
    c.emit('ready');

    expect(c.subscribeCalls).toEqual([]);
  });

  it('si el SUBSCRIBE inicial falla, el canal queda en el Map para que `ready` lo reintente', async () => {
    // No se puede fallar en el primer subscribe sin cliente creado, así que se
    // crea uno con un canal y después se pone a fallar.
    const off = await hub.subscribe('im:user:0', () => undefined);
    off();

    const c = client();
    c.subscribeRejects = true;
    const sink = vi.fn();
    await expect(hub.subscribe('im:user:1', sink)).resolves.toBeTypeOf('function');

    // El sink queda registrado pese al fallo.
    expect(hub.hubStats()).toEqual({ channels: 1, sinks: 1 });

    c.subscribeRejects = false;
    c.subscribeCalls.length = 0;
    c.emit('ready');

    expect(c.subscribeCalls).toEqual([['im:user:1']]);
  });

  it('un error del cliente se loguea y no se propaga', async () => {
    await hub.subscribe('im:user:1', () => undefined);
    expect(() => client().emit('error', new Error('ECONNRESET'))).not.toThrow();
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('sin REDIS_URL', () => {
  it('subscribe devuelve un no-op y no crea cliente ioredis', async () => {
    h.env.REDIS_URL = undefined;
    hub = await freshHub();

    const sink = vi.fn();
    const off = await hub.subscribe('im:user:1', sink);

    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
    expect(h.FakeRedis.instances).toHaveLength(0);
    expect(hub.hubStats()).toEqual({ channels: 0, sinks: 0 });
  });
});

describe('configuración del cliente', () => {
  it('usa un cliente dedicado con reconexión agresiva', async () => {
    await hub.subscribe('im:user:1', () => undefined);
    const c = client();

    expect(c.url).toBe('redis://localhost:6379');
    expect(c.opts.maxRetriesPerRequest).toBeNull();
    const retry = c.opts.retryStrategy as (times: number) => number;
    expect(retry(1)).toBe(200);
    // Techo de 5 s: no se queda esperando minutos tras un redeploy largo.
    expect(retry(1000)).toBe(5000);
  });
});
