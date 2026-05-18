import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Stubbeamos las dependencias pesadas (DB, factory, agente, multimodal,
// outbound) para poder ejercitar el control de flujo sin red ni Postgres.
const mocks = vi.hoisted(() => {
  // Cola FIFO de respuestas para db.select(). Cada test inicia con
  // pushSelect(...) los shapes que devolverán las queries en orden.
  const selectQueue: unknown[][] = [];
  return {
    selectQueue,
    updateConv: vi.fn(),
    buildConnector: vi.fn(),
    processInboundMessages: vi.fn(),
    runWhatsappAgent: vi.fn(),
    sendAgentResponse: vi.fn(),
    writeAgentRun: vi.fn(),
  };
});

// Mock del db client con un router por tabla. El SUT hace varios queries
// distintos; los devolvemos en orden según lo que pidan los step.run.
vi.mock('@/lib/db/client', () => {
  // Cada llamada a db.select() debe devolver un encadenable que termina con
  // .limit() resolviendo a un array. Usamos un mock muy simple que delega en
  // mocks.selectStack para que cada test decida la respuesta.
  const makeChain = (resolver: () => Promise<unknown[]>) => {
    const chain = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => resolver(),
    };
    return chain;
  };
  const updateChain = {
    set: () => updateChain,
    where: async () => {
      mocks.updateConv();
    },
  };
  return {
    db: {
      select: (_cols?: unknown) =>
        makeChain(async () => {
          // FIFO: cada test usa pushSelect(rows) en el mismo orden en que
          // el SUT hace queries. Si falta, devolvemos [] para que cualquier
          // query no esperada caiga limpio.
          const next = mocks.selectQueue.shift();
          return next ?? [];
        }),
      update: () => updateChain,
    },
  };
});

vi.mock('@/lib/db/schema', () => ({
  whatsappAgentRuns: { conversationId: 'conv', createdAt: 'createdAt' },
  whatsappConnections: { tenantId: 'tenantId', status: 'status', updatedAt: 'updatedAt' },
  whatsappConversations: { id: 'id' },
  whatsappMessages: {
    tenantId: 'tenantId',
    conversationId: 'conversationId',
    direction: 'direction',
    createdAt: 'createdAt',
    internalNote: 'internalNote',
  },
}));

vi.mock('@/lib/whatsapp/factory', () => ({
  buildConnector: mocks.buildConnector,
}));

vi.mock('@/lib/whatsapp/agent', () => ({
  runWhatsappAgent: mocks.runWhatsappAgent,
}));

vi.mock('@/lib/whatsapp/agent/persist-run', () => ({
  writeAgentRun: mocks.writeAgentRun,
}));

vi.mock('@/lib/whatsapp/agent/multimodal', () => ({
  processInboundMessages: mocks.processInboundMessages,
}));

vi.mock('@/lib/whatsapp/outbound/send-response', () => ({
  sendAgentResponse: mocks.sendAgentResponse,
}));

// Importar después de los mocks.
import { processWhatsappJob } from '@/worker/jobs/whatsapp-process';

const ENABLED_ENV = { ...process.env };

function pushSelect(rows: unknown[]) {
  mocks.selectQueue.push(rows);
}

function baseEvent() {
  return {
    tenantId: 'tenant-1',
    conversationId: 'conv-1',
    messageId: 'msg-1',
    contactPhoneE164: '+34699111222',
  };
}

function runHandler() {
  return processWhatsappJob(baseEvent(), {
    run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
  });
}

beforeEach(() => {
  process.env = { ...ENABLED_ENV, WHATSAPP_AGENT_ENABLED: 'true' };
  mocks.selectQueue.length = 0;
  mocks.buildConnector.mockReset();
  mocks.processInboundMessages.mockReset();
  mocks.runWhatsappAgent.mockReset();
  mocks.sendAgentResponse.mockReset();
  mocks.writeAgentRun.mockReset();
  mocks.updateConv.mockReset();
});

afterEach(() => {
  process.env = ENABLED_ENV;
});

describe('whatsappProcess handler', () => {
  it('feature flag apagada → sale sin tocar DB', async () => {
    process.env.WHATSAPP_AGENT_ENABLED = 'false';
    const out = (await runHandler()) as { ok: boolean; reason?: string };
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('feature_disabled');
    expect(mocks.runWhatsappAgent).not.toHaveBeenCalled();
  });

  it('conversation_not_found → sale temprano', async () => {
    pushSelect([]); // gate-check: select conv
    const out = (await runHandler()) as { ok: boolean; reason?: string };
    expect(out.reason).toBe('conversation_not_found');
    expect(mocks.runWhatsappAgent).not.toHaveBeenCalled();
  });

  it('ai_enabled=false → sale sin invocar agente', async () => {
    pushSelect([
      {
        id: 'conv-1',
        contactId: 'contact-1',
        status: 'ACTIVE',
        aiEnabled: false,
        humanTakeoverUntil: null,
        channel: 'WHATSAPP_CLOUD',
      },
    ]);
    const out = (await runHandler()) as { ok: boolean; reason?: string };
    expect(out.reason).toBe('ai_disabled');
    expect(mocks.runWhatsappAgent).not.toHaveBeenCalled();
  });

  it('status=HANDOFF → sale (humano controlando)', async () => {
    pushSelect([
      {
        id: 'conv-1',
        contactId: 'contact-1',
        status: 'HANDOFF',
        aiEnabled: true,
        humanTakeoverUntil: null,
        channel: 'WHATSAPP_CLOUD',
      },
    ]);
    const out = (await runHandler()) as { ok: boolean; reason?: string };
    expect(out.reason).toBe('status_HANDOFF');
  });

  it('humanTakeoverUntil futuro → sale (takeover activo)', async () => {
    const future = new Date(Date.now() + 60_000);
    pushSelect([
      {
        id: 'conv-1',
        contactId: 'contact-1',
        status: 'ACTIVE',
        aiEnabled: true,
        humanTakeoverUntil: future,
        channel: 'WHATSAPP_CLOUD',
      },
    ]);
    const out = (await runHandler()) as { ok: boolean; reason?: string };
    expect(out.reason).toBe('human_takeover_active');
  });

  it('flujo completo: gate OK → batch → agent → outbound → persist', async () => {
    // 1) gate-check
    pushSelect([
      {
        id: 'conv-1',
        contactId: 'contact-1',
        status: 'ACTIVE',
        aiEnabled: true,
        humanTakeoverUntil: null,
        channel: 'WHATSAPP_CLOUD',
      },
    ]);
    // 2) loadInboundBatch → lastRun query (sin runs previos)
    pushSelect([]);
    // 3) loadInboundBatch → mensajes inbound
    const msg = {
      id: 'msg-1',
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      direction: 'INBOUND',
      type: 'TEXT',
      contentText: 'Hola',
      createdAt: new Date(),
      externalId: 'ext-1',
      mediaUrl: null,
      mediaType: null,
      transcription: null,
      rawJson: {},
    };
    pushSelect([msg]);
    // 4) loadInboundBatch → existing run check (vacío)
    pushSelect([]);
    // 5) resolveConnector → whatsapp_connections (vacío → connector null OK
    //    porque tenemos sendAgentResponse mockeado de todos modos; en el
    //    código real sin connector saltaría el send. Para este test damos
    //    una conexión).
    pushSelect([
      {
        id: 'conn-1',
        tenantId: 'tenant-1',
        mode: 'CLOUD',
        status: 'CONNECTED',
        phoneId: 'ph-1',
        cloudAccessTokenEnc: 'enc',
        cloudAppSecretEnc: 'enc',
      },
    ]);
    mocks.buildConnector.mockReturnValue({ channel: 'whatsapp_cloud' } as never);
    // 6) loadHistory → cero turnos
    pushSelect([]);

    mocks.processInboundMessages.mockResolvedValue({
      combinedText: '[t+0s] Hola',
      totalLatencyMs: 5,
    });
    mocks.runWhatsappAgent.mockResolvedValue({
      intent: 'OTHER',
      intentConfidence: 0.5,
      intentReasoning: null,
      responseText: 'Hola, ¿en qué te puedo ayudar?',
      responseButtons: null,
      handoff: false,
      urgent: false,
      model: 'gemini-flash-latest',
      tokensIn: 100,
      tokensOut: 10,
      latencyMs: 800,
      fallbackUsed: false,
      toolsCalled: [],
      errorText: null,
      traceId: null,
    });
    mocks.sendAgentResponse.mockResolvedValue({
      messageId: 'out-1',
      externalId: 'wamid-1',
      kind: 'text',
    });

    const out = (await runHandler()) as { ok: boolean; intent?: string };
    expect(out.ok).toBe(true);
    expect(out.intent).toBe('OTHER');
    expect(mocks.runWhatsappAgent).toHaveBeenCalledTimes(1);
    expect(mocks.sendAgentResponse).toHaveBeenCalledTimes(1);
    expect(mocks.writeAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerMessageId: 'msg-1',
        responseMessageId: 'out-1',
        intent: 'OTHER',
      }),
    );
    expect(mocks.updateConv).not.toHaveBeenCalled(); // no handoff
  });

  it('agente decide HANDOFF → actualiza conv a HANDOFF y envía respuesta plantillada', async () => {
    pushSelect([
      {
        id: 'conv-1',
        contactId: 'contact-1',
        status: 'ACTIVE',
        aiEnabled: true,
        humanTakeoverUntil: null,
        channel: 'WHATSAPP_CLOUD',
      },
    ]);
    pushSelect([]);
    pushSelect([
      {
        id: 'msg-1',
        tenantId: 'tenant-1',
        conversationId: 'conv-1',
        direction: 'INBOUND',
        type: 'TEXT',
        contentText: 'quiero factura',
        createdAt: new Date(),
        externalId: 'ext-1',
        mediaUrl: null,
        mediaType: null,
        transcription: null,
        rawJson: {},
      },
    ]);
    pushSelect([]);
    pushSelect([
      {
        id: 'conn-1',
        tenantId: 'tenant-1',
        mode: 'CLOUD',
        status: 'CONNECTED',
        phoneId: 'ph-1',
        cloudAccessTokenEnc: 'enc',
        cloudAppSecretEnc: 'enc',
      },
    ]);
    pushSelect([]);

    mocks.buildConnector.mockReturnValue({ channel: 'whatsapp_cloud' } as never);
    mocks.processInboundMessages.mockResolvedValue({
      combinedText: 'quiero factura',
      totalLatencyMs: 1,
    });
    mocks.runWhatsappAgent.mockResolvedValue({
      intent: 'HANDOFF',
      intentConfidence: 1.0,
      intentReasoning: null,
      responseText: 'Te paso con recepción.',
      responseButtons: null,
      handoff: true,
      urgent: false,
      model: 'gemini-flash-latest',
      tokensIn: 50,
      tokensOut: 5,
      latencyMs: 400,
      fallbackUsed: false,
      toolsCalled: [
        { name: 'request_handoff', args: {}, ok: true, result: 'HANDOFF', latencyMs: 1 },
      ],
      errorText: null,
      traceId: null,
    });
    mocks.sendAgentResponse.mockResolvedValue({
      messageId: 'out-1',
      externalId: 'wamid-1',
      kind: 'text',
    });

    const out = (await runHandler()) as { ok: boolean; handoff: boolean };
    expect(out.ok).toBe(true);
    expect(out.handoff).toBe(true);
    expect(mocks.updateConv).toHaveBeenCalled();
  });

  it('idempotencia: trigger ya tiene run → already_processed sin LLM', async () => {
    pushSelect([
      {
        id: 'conv-1',
        contactId: 'contact-1',
        status: 'ACTIVE',
        aiEnabled: true,
        humanTakeoverUntil: null,
        channel: 'WHATSAPP_CLOUD',
      },
    ]);
    pushSelect([]); // lastRun
    pushSelect([
      {
        id: 'msg-1',
        tenantId: 'tenant-1',
        conversationId: 'conv-1',
        direction: 'INBOUND',
        type: 'TEXT',
        contentText: 'Hola',
        createdAt: new Date(),
        externalId: 'ext-1',
        mediaUrl: null,
        mediaType: null,
        transcription: null,
        rawJson: {},
      },
    ]);
    // existing run para ese trigger → already_processed
    pushSelect([{ id: 'pre-existing-run' }]);

    const out = (await runHandler()) as { ok: boolean; reason?: string };
    expect(out.reason).toBe('already_processed');
    expect(mocks.runWhatsappAgent).not.toHaveBeenCalled();
  });
});
