import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Idempotencia del módulo Mensajes.
//
// Todo lo que puede reintentarse (un webhook de GHL, un job de BullMQ, el envío
// optimista del navegador) pasa por una clave de deduplicación. Si una de esas
// claves deja de ser estable o de ser simétrica, el chat se llena de tarjetas
// repetidas y los DM se duplican en dos canales distintos — con la mitad de la
// conversación en cada uno. Se testea contra el valor EXACTO que se le pasa al
// INSERT, sin base de datos.

const dbState = vi.hoisted(() => ({
  inserts: [] as Array<{
    table: unknown;
    values: unknown;
    conflict: 'nothing' | 'update' | null;
  }>,
  updates: [] as Array<{ table: unknown; set: Record<string, unknown> }>,
  /** Cola de filas devueltas por cada `.returning()`. */
  insertReturns: [] as Array<Array<Record<string, unknown>>>,
  /** Cola de filas devueltas por cada SELECT. */
  selectReturns: [] as Array<Array<Record<string, unknown>>>,
}));

vi.mock('@/lib/db/client', () => {
  const nextSelect = () => dbState.selectReturns.shift() ?? [];
  const nextInsert = () => dbState.insertReturns.shift() ?? [];

  function selectChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.from = self;
    chain.innerJoin = self;
    chain.leftJoin = self;
    chain.where = self;
    chain.groupBy = self;
    chain.orderBy = self;
    chain.limit = () => Promise.resolve(nextSelect());
    // Thenable: cubre las queries que se esperan sin `.limit()`.
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(nextSelect()).then(res, rej);
    return chain;
  }

  function insertBuilder(table: unknown) {
    return {
      values(values: unknown) {
        const call = { table, values, conflict: null as 'nothing' | 'update' | null };
        dbState.inserts.push(call);
        const returning = () => Promise.resolve(nextInsert());
        const settled = {
          returning,
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(undefined).then(res, rej),
          catch: () => Promise.resolve(undefined),
        };
        return {
          returning,
          onConflictDoNothing: () => {
            call.conflict = 'nothing';
            return settled;
          },
          onConflictDoUpdate: () => {
            call.conflict = 'update';
            return settled;
          },
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(undefined).then(res, rej),
        };
      },
    };
  }

  const api = {
    select: () => selectChain(),
    insert: (table: unknown) => insertBuilder(table),
    update: (table: unknown) => ({
      set(set: Record<string, unknown>) {
        dbState.updates.push({ table, set });
        return { where: () => Promise.resolve(undefined) };
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(api),
  };

  return { db: api };
});

vi.mock('@/lib/tenant', () => ({
  getCurrentTenant: async () => ({
    tenant: { id: 'tenant-1', clerkOrganizationId: 'org_1' },
    userId: 'user_clerk_1',
  }),
}));

vi.mock('@/lib/tasks/materialize', () => ({
  getTenantTimezone: async () => 'Europe/Madrid',
  formatDateTime: () => '3 de marzo, 10:00',
  formatDate: () => '3 de marzo',
  fullName: (a: string, b: string) => `${a} ${b}`,
}));

vi.mock('@/lib/messaging/publisher', () => ({
  publishToUsers: async () => undefined,
  publishToChannelMembers: async () => undefined,
  publishToTenant: async () => undefined,
  publishTyping: async () => undefined,
  touchPresence: async () => undefined,
  clearPresence: async () => undefined,
  readPresence: async () => [],
}));

vi.mock('@/lib/messaging/queries', () => ({
  DELETED_BODY: 'Mensaje eliminado',
  loadPeople: async () => [],
  personMap: () => new Map(),
  loadReactionsFor: async () => new Map(),
  toMessageDTO: (row: Record<string, unknown>) => ({ id: row.id, senderName: null }),
}));

import {
  createChannel,
  ensureContextChannel,
  ensureDmChannel,
  ensureSlugChannel,
} from '@/lib/messaging/channels';
import { SEED_CHANNELS } from '@/lib/messaging/constants';
import { imChannelMembers, imChannels, imMessages } from '@/lib/db/schema';

beforeEach(() => {
  dbState.inserts = [];
  dbState.updates = [];
  dbState.insertReturns = [];
  dbState.selectReturns = [];
  vi.restoreAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

/** Los valores con los que se intentó crear el canal. */
function channelInsert(): Record<string, unknown> {
  const call = dbState.inserts.find((c) => c.table === imChannels);
  if (!call) throw new Error('no hubo INSERT sobre im_channels');
  return call.values as Record<string, unknown>;
}

function memberInserts(): Array<Record<string, unknown>> {
  return dbState.inserts
    .filter((c) => c.table === imChannelMembers)
    .flatMap((c) => (Array.isArray(c.values) ? c.values : [c.values])) as Array<
    Record<string, unknown>
  >;
}

// ─── DM: la clave tiene que ser simétrica ───────────────────────────────────

describe('ensureDmChannel — dedupe_key simétrica', () => {
  it('(A,B) y (B,A) generan exactamente la misma clave', async () => {
    dbState.insertReturns = [[{ id: 'dm-1' }]];
    await ensureDmChannel({ tenantId: 't1', userIdA: 'aaa', userIdB: 'zzz' });
    const primera = channelInsert().dedupeKey;

    dbState.inserts = [];
    dbState.insertReturns = [[{ id: 'dm-1' }]];
    await ensureDmChannel({ tenantId: 't1', userIdA: 'zzz', userIdB: 'aaa' });
    const segunda = channelInsert().dedupeKey;

    expect(primera).toBe('dm:aaa:zzz');
    expect(segunda).toBe(primera);
  });

  it('ordena los ids aunque vengan de UUIDs cualesquiera', async () => {
    const a = 'f0000000-0000-0000-0000-000000000000';
    const b = '10000000-0000-0000-0000-000000000000';

    dbState.insertReturns = [[{ id: 'dm-1' }]];
    await ensureDmChannel({ tenantId: 't1', userIdA: a, userIdB: b });
    expect(channelInsert().dedupeKey).toBe(`dm:${b}:${a}`);
  });

  it('el canal se crea como DM y suma a los dos como OWNER', async () => {
    dbState.insertReturns = [[{ id: 'dm-1' }]];
    await ensureDmChannel({ tenantId: 't1', userIdA: 'u-b', userIdB: 'u-a' });

    expect(channelInsert()).toMatchObject({ tenantId: 't1', kind: 'DM' });
    expect(memberInserts()).toEqual([
      { channelId: 'dm-1', userId: 'u-a', tenantId: 't1', role: 'OWNER' },
      { channelId: 'dm-1', userId: 'u-b', tenantId: 't1', role: 'OWNER' },
    ]);
  });

  it('si el INSERT choca con el índice único, resuelve por la misma clave', async () => {
    dbState.insertReturns = [[]]; // conflicto: no devuelve fila
    dbState.selectReturns = [[{ id: 'dm-existente' }]];

    await expect(
      ensureDmChannel({ tenantId: 't1', userIdA: 'u-a', userIdB: 'u-b' }),
    ).resolves.toEqual({ id: 'dm-existente' });
  });

  it('un DM con uno mismo produce una clave con el id repetido (no rompe)', async () => {
    dbState.insertReturns = [[{ id: 'dm-solo' }]];
    await ensureDmChannel({ tenantId: 't1', userIdA: 'u-a', userIdB: 'u-a' });
    expect(channelInsert().dedupeKey).toBe('dm:u-a:u-a');
  });

  it('sin fila y sin canal previo, lanza en lugar de devolver un id inválido', async () => {
    dbState.insertReturns = [[]];
    dbState.selectReturns = [[]];
    await expect(
      ensureDmChannel({ tenantId: 't1', userIdA: 'u-a', userIdB: 'u-b' }),
    ).rejects.toThrow('No se pudo crear el mensaje directo');
  });
});

// ─── Canales de contexto ────────────────────────────────────────────────────

describe('ensureContextChannel — dedupe_key estable por (tipo, id)', () => {
  it('usa `<tipo en minúsculas>:<id>`', async () => {
    dbState.insertReturns = [[{ id: 'ctx-1' }]];
    await ensureContextChannel({
      tenantId: 't1',
      contextType: 'PATIENT',
      contextId: 'pac-9',
      label: 'Marta Ruiz',
      createdByUserId: 'u-1',
    });

    expect(channelInsert()).toMatchObject({
      kind: 'CONTEXT',
      dedupeKey: 'patient:pac-9',
      contextType: 'PATIENT',
      contextId: 'pac-9',
      contextLabel: 'Marta Ruiz',
    });
  });

  it('la clave es idéntica en dos llamadas con el mismo (tipo, id)', async () => {
    dbState.insertReturns = [[{ id: 'ctx-1' }], [{ id: 'ctx-1' }]];

    await ensureContextChannel({
      tenantId: 't1',
      contextType: 'CALL',
      contextId: 'call-7',
      label: 'Llamada de Marta',
      createdByUserId: 'u-1',
    });
    const primera = channelInsert().dedupeKey;

    dbState.inserts = [];
    await ensureContextChannel({
      tenantId: 't1',
      contextType: 'CALL',
      contextId: 'call-7',
      label: 'Otro rótulo, mismo hilo',
      createdByUserId: 'u-2',
    });

    expect(channelInsert().dedupeKey).toBe(primera);
    expect(primera).toBe('call:call-7');
  });

  it('distinto tipo con el mismo id NO colisiona', async () => {
    dbState.insertReturns = [[{ id: 'a' }], [{ id: 'b' }]];

    await ensureContextChannel({
      tenantId: 't1',
      contextType: 'TASK',
      contextId: 'x1',
      label: 'Tarea',
      createdByUserId: 'u-1',
    });
    const tarea = channelInsert().dedupeKey;

    dbState.inserts = [];
    await ensureContextChannel({
      tenantId: 't1',
      contextType: 'APPOINTMENT',
      contextId: 'x1',
      label: 'Cita',
      createdByUserId: 'u-1',
    });

    expect(tarea).toBe('task:x1');
    expect(channelInsert().dedupeKey).toBe('appointment:x1');
  });

  it('recorta el rótulo a 200 caracteres', async () => {
    dbState.insertReturns = [[{ id: 'ctx-1' }]];
    await ensureContextChannel({
      tenantId: 't1',
      contextType: 'PATIENT',
      contextId: 'p1',
      label: 'x'.repeat(500),
      createdByUserId: 'u-1',
    });

    const row = channelInsert();
    expect((row.name as string).length).toBe(200);
    expect((row.contextLabel as string).length).toBe(200);
  });

  it('sin miembros ni autor, suma a todo el tenant', async () => {
    dbState.insertReturns = [[{ id: 'ctx-1' }]];
    dbState.selectReturns = [[{ userId: 'u-1' }, { userId: 'u-2' }]];

    await ensureContextChannel({
      tenantId: 't1',
      contextType: 'PATIENT',
      contextId: 'p1',
      label: 'Marta',
    });

    expect(memberInserts().map((m) => m.userId)).toEqual(['u-1', 'u-2']);
  });
});

// ─── Canales por slug ───────────────────────────────────────────────────────

describe('ensureSlugChannel — dedupe_key `slug:<slug>`', () => {
  it('un canal sembrado se crea con nombre, tema y tono del catálogo', async () => {
    dbState.insertReturns = [[{ id: 'ch-urg' }]];
    dbState.selectReturns = [[{ userId: 'u-1' }]];

    await ensureSlugChannel({ tenantId: 't1', slug: 'urgencias' });

    const seed = SEED_CHANNELS.find((c) => c.slug === 'urgencias')!;
    expect(channelInsert()).toMatchObject({
      kind: 'PUBLIC',
      slug: 'urgencias',
      dedupeKey: 'slug:urgencias',
      name: seed.name,
      topic: seed.topic,
      tone: seed.tone,
      isSystem: true,
    });
  });

  it('normaliza mayúsculas y espacios antes de armar la clave', async () => {
    dbState.insertReturns = [[{ id: 'ch-1' }]];
    dbState.selectReturns = [[]];

    await ensureSlugChannel({ tenantId: 't1', slug: '  General  ' });

    expect(channelInsert()).toMatchObject({ slug: 'general', dedupeKey: 'slug:general' });
  });

  it('un slug fuera del catálogo no se marca como canal de sistema', async () => {
    dbState.insertReturns = [[{ id: 'ch-2' }]];
    dbState.selectReturns = [[]];

    await ensureSlugChannel({ tenantId: 't1', slug: 'protesis' });

    expect(channelInsert()).toMatchObject({
      slug: 'protesis',
      dedupeKey: 'slug:protesis',
      name: 'Protesis',
      isSystem: false,
    });
  });

  it('los tres canales sembrados tienen slugs distintos (claves distintas)', () => {
    const slugs = SEED_CHANNELS.map((c) => `slug:${c.slug}`);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('createChannel', () => {
  it('con slug arma `slug:<slug>`; sin slug la clave queda nula', async () => {
    dbState.insertReturns = [[{ id: 'ch-1' }]];
    await createChannel({
      tenantId: 't1',
      kind: 'PUBLIC',
      slug: 'Protesis',
      name: 'Prótesis',
      createdByUserId: 'u-1',
      memberUserIds: [],
    });
    expect(channelInsert()).toMatchObject({ slug: 'protesis', dedupeKey: 'slug:protesis' });

    dbState.inserts = [];
    dbState.insertReturns = [[{ id: 'ch-2' }]];
    await createChannel({
      tenantId: 't1',
      kind: 'GROUP',
      name: 'Turno de tarde',
      createdByUserId: 'u-1',
      memberUserIds: ['u-2'],
    });
    expect(channelInsert().dedupeKey).toBeNull();
  });

  it('el creador entra como OWNER y no se duplica si también viene en la lista', async () => {
    dbState.insertReturns = [[{ id: 'ch-1' }]];
    await createChannel({
      tenantId: 't1',
      kind: 'GROUP',
      name: 'Turno de tarde',
      createdByUserId: 'u-1',
      memberUserIds: ['u-1', 'u-2'],
    });

    const miembros = memberInserts();
    expect(miembros.filter((m) => m.userId === 'u-1')).toEqual([
      { channelId: 'ch-1', userId: 'u-1', tenantId: 't1', role: 'OWNER' },
    ]);
    expect(miembros.filter((m) => m.userId === 'u-2')).toHaveLength(1);
  });
});

// ─── Mensajes: client_nonce y dedupe_key ────────────────────────────────────

describe('sendMessage — idempotencia por partida doble', () => {
  it('propaga client_nonce y dedupe_key al INSERT', async () => {
    dbState.insertReturns = [[]];
    dbState.selectReturns = [[{ id: 'msg-previo' }]];

    const { sendMessage } = await import('@/lib/messaging/service');
    await sendMessage({
      tenantId: 't1',
      channelId: 'c1',
      senderUserId: 'u-1',
      body: 'hola',
      clientNonce: 'nonce-abc',
      dedupeKey: 'evt:call.missed:call-1',
    });

    const insert = dbState.inserts.find((c) => c.table === imMessages)!
      .values as Record<string, unknown>;
    expect(insert).toMatchObject({
      clientNonce: 'nonce-abc',
      dedupeKey: 'evt:call.missed:call-1',
    });
  });

  it('un reintento que choca devuelve el id original con created:false', async () => {
    dbState.insertReturns = [[]]; // el índice único parcial frenó el INSERT
    dbState.selectReturns = [[{ id: 'msg-previo' }]];

    const { sendMessage } = await import('@/lib/messaging/service');
    await expect(
      sendMessage({
        tenantId: 't1',
        channelId: 'c1',
        senderUserId: 'u-1',
        body: 'hola',
        clientNonce: 'nonce-abc',
      }),
    ).resolves.toEqual({ id: 'msg-previo', created: false });
  });

  it('si choca y no se encuentra el original, lanza en vez de mentir', async () => {
    dbState.insertReturns = [[]];
    dbState.selectReturns = [[], []];

    const { sendMessage } = await import('@/lib/messaging/service');
    await expect(
      sendMessage({
        tenantId: 't1',
        channelId: 'c1',
        senderUserId: 'u-1',
        body: 'hola',
        dedupeKey: 'evt:x:1',
      }),
    ).rejects.toThrow('El mensaje no se pudo guardar');
  });

  it('sin nonce ni dedupeKey no hay nada por lo que reconciliar', async () => {
    dbState.insertReturns = [[]];

    const { sendMessage } = await import('@/lib/messaging/service');
    await expect(
      sendMessage({ tenantId: 't1', channelId: 'c1', senderUserId: 'u-1', body: 'hola' }),
    ).rejects.toThrow('El mensaje no se pudo guardar');
  });

  it('el alta real devuelve created:true', async () => {
    dbState.insertReturns = [[{ id: 'msg-1', createdAt: new Date('2026-03-03T10:00:00Z') }]];

    const { sendMessage } = await import('@/lib/messaging/service');
    await expect(
      sendMessage({
        tenantId: 't1',
        channelId: 'c1',
        senderUserId: 'u-1',
        body: 'hola',
        clientNonce: 'nonce-nuevo',
      }),
    ).resolves.toEqual({ id: 'msg-1', created: true });
  });
});

// ─── Claves de evento del bot ───────────────────────────────────────────────

describe('bot — claves `evt:<evento>:<entidad>`', () => {
  const sendMessage = vi.fn(async () => ({ id: 'msg-1', created: true }));

  async function loadBot(): Promise<typeof import('@/lib/messaging/bot')> {
    vi.resetModules();
    vi.doMock('@/lib/messaging/service', () => ({ sendMessage }));
    return import('@/lib/messaging/bot');
  }

  beforeEach(() => {
    sendMessage.mockClear();
    // Cada `ensureSlugChannel` real hace un INSERT (canal) y un SELECT
    // (miembros del tenant) contra el mock de db.
    dbState.insertReturns = [[{ id: 'canal-1' }], [{ id: 'canal-1' }]];
    dbState.selectReturns = [[], [], []];
  });

  it('sin dedupeKey explícita usa `evt:<evento>:<id de contexto>`', async () => {
    const bot = await loadBot();
    await bot.postSystemEvent({
      tenantId: 't1',
      event: 'appointment.cancelled',
      title: 'Cita cancelada',
      context: { type: 'APPOINTMENT', id: 'appt-9', payload: {} },
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]![0]).toMatchObject({
      dedupeKey: 'evt:appointment.cancelled:appt-9',
      eventKey: 'appointment.cancelled',
      senderKind: 'BOT',
      kind: 'EVENT',
    });
  });

  it('sin contexto cae al tenantId, que sigue siendo estable', async () => {
    const bot = await loadBot();
    await bot.postSystemEvent({
      tenantId: 't1',
      event: 'analytics.daily_digest',
      title: 'Resumen del día',
    });

    expect(sendMessage.mock.calls[0]![0]).toMatchObject({
      dedupeKey: 'evt:analytics.daily_digest:t1',
    });
  });

  it('una dedupeKey explícita gana sobre la derivada', async () => {
    const bot = await loadBot();
    await bot.postSystemEvent({
      tenantId: 't1',
      event: 'call.missed',
      title: 'Llamada perdida',
      context: { type: 'CALL', id: 'call-1', payload: {} },
      dedupeKey: 'evt:call.missed:call-1:reintento',
    });

    expect(sendMessage.mock.calls[0]![0]).toMatchObject({
      dedupeKey: 'evt:call.missed:call-1:reintento',
    });
  });

  it('postMissedCall deduplica por llamada, y cambia de evento si fue un traspaso', async () => {
    const bot = await loadBot();

    await bot.postMissedCall({
      tenantId: 't1',
      callId: 'call-7',
      patientName: 'Marta',
      phone: '+34600111222',
    });
    expect(sendMessage.mock.calls[0]![0]).toMatchObject({
      dedupeKey: 'evt:call.missed:call-7',
    });

    sendMessage.mockClear();
    dbState.insertReturns = [[{ id: 'canal-1' }]];
    dbState.selectReturns = [[]];

    await bot.postMissedCall({
      tenantId: 't1',
      callId: 'call-7',
      patientName: 'Marta',
      phone: null,
      transferredUnanswered: true,
    });
    expect(sendMessage.mock.calls[0]![0]).toMatchObject({
      dedupeKey: 'evt:call.transferred_unanswered:call-7',
    });
  });

  it('la misma llamada dos veces produce la MISMA clave (el reintento no duplica)', async () => {
    const bot = await loadBot();

    await bot.postMissedCall({
      tenantId: 't1',
      callId: 'call-7',
      patientName: 'Marta',
      phone: null,
    });
    const primera = sendMessage.mock.calls[0]![0] as { dedupeKey: string };

    sendMessage.mockClear();
    dbState.insertReturns = [[{ id: 'canal-1' }]];
    dbState.selectReturns = [[]];

    await bot.postMissedCall({
      tenantId: 't1',
      callId: 'call-7',
      patientName: 'Marta',
      phone: null,
    });
    const segunda = sendMessage.mock.calls[0]![0] as { dedupeKey: string };

    expect(segunda.dedupeKey).toBe(primera.dedupeKey);
  });

  it('postSlotOpen deduplica por el hueco cancelado', async () => {
    const bot = await loadBot();
    await bot.postSlotOpen({
      tenantId: 't1',
      cancelledSlotId: 'slot-3',
      slotStart: new Date('2026-03-03T10:00:00Z'),
    });

    expect(sendMessage.mock.calls[0]![0]).toMatchObject({
      dedupeKey: 'evt:waitlist.slot_open:slot-3',
    });
  });

  it('el handoff de WhatsApp deduplica por conversación Y por día', async () => {
    const bot = await loadBot();
    await bot.postWhatsappHandoff({
      tenantId: 't1',
      conversationId: 'conv-4',
      patientName: 'Marta',
      phone: null,
      reason: 'pidió hablar con una persona',
    });

    const hoy = new Date().toISOString().slice(0, 10);
    expect(sendMessage.mock.calls[0]![0]).toMatchObject({
      dedupeKey: `evt:wa.handoff:conv-4:${hoy}`,
    });
  });

  it('postSystemEvent nunca lanza aunque el envío falle', async () => {
    const bot = await loadBot();
    sendMessage.mockRejectedValueOnce(new Error('la migración 0019 no está aplicada'));

    await expect(
      bot.postSystemEvent({ tenantId: 't1', event: 'call.missed', title: 'x' }),
    ).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });
});
