import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Mocks compartidos vía vi.hoisted para que estén disponibles en las
// factories de vi.mock (que se hoistean antes de cualquier código top-level).
// Las constantes plantilladas viven dentro de vi.hoisted porque vi.mock se
// hoistea ANTES que cualquier const top-level y necesita los valores.
const mocks = vi.hoisted(() => ({
  loadGrounding: vi.fn(),
  callLLM: vi.fn(),
  executeAgentTool: vi.fn(),
  HANDOFF_RESPONSE_TEXT: 'Te paso con recepción. En breve te contactan para ayudarte.',
  URGENT_RESPONSE_TEXT:
    'Eso requiere valoración presencial. Recepción te contactará lo antes posible. Si tienes dolor intenso o sangrado importante, llama al 112.',
}));

const HANDOFF_RESPONSE_TEXT = mocks.HANDOFF_RESPONSE_TEXT;
const URGENT_RESPONSE_TEXT = mocks.URGENT_RESPONSE_TEXT;

vi.mock('@/lib/whatsapp/agent/prompt', () => ({
  HANDOFF_RESPONSE_TEXT: mocks.HANDOFF_RESPONSE_TEXT,
  URGENT_RESPONSE_TEXT: mocks.URGENT_RESPONSE_TEXT,
  buildSystemPrompt: () => 'SYSTEM_PROMPT_STUB',
  loadGroundingForTenant: mocks.loadGrounding,
}));

vi.mock('@/lib/whatsapp/agent/llm', () => ({
  callLLM: mocks.callLLM,
}));

vi.mock('@/lib/whatsapp/agent/tools', () => ({
  executeAgentTool: mocks.executeAgentTool,
  // El orquestador llama getAgentToolDefinitions pero solo para pasarlas a
  // callLLM, que está mockeado. Devolvemos un placeholder mínimo.
  getAgentToolDefinitions: () => [],
}));

import { runWhatsappAgent } from '@/lib/whatsapp/agent';

function baseInput() {
  return {
    tenantId: 'tenant-1',
    conversationId: 'conv-1',
    contactId: 'contact-1',
    contactPhoneE164: '+34699111222',
    userText: 'Hola, ¿hay hueco para una limpieza?',
    history: [],
    triggerMessageId: 'msg-1',
  };
}

beforeEach(() => {
  mocks.loadGrounding.mockReset();
  mocks.callLLM.mockReset();
  mocks.executeAgentTool.mockReset();
  mocks.loadGrounding.mockResolvedValue({
    clinic: {
      name: 'Clínica Test',
      address: 'C/ Falsa 123',
      phones: '+34 911 222 333',
      workingHours: 'lunes 09:00-14:00',
      timezone: 'Europe/Madrid',
      transferNumber: '+34 911 222 333',
    },
    treatments: [],
    faqs: [],
  });
});

describe('runWhatsappAgent', () => {
  it('LLM responde texto directo sin tools → intent=OTHER, no handoff', async () => {
    mocks.callLLM.mockResolvedValue({
      text: 'Vale, te ayudo con eso.',
      toolCalls: [],
      tokensIn: 120,
      tokensOut: 8,
      model: 'gemini-flash-latest',
      latencyMs: 800,
      fallbackUsed: false,
    });

    const out = await runWhatsappAgent(baseInput());

    expect(out.intent).toBe('OTHER');
    expect(out.intentConfidence).toBe(0.5);
    expect(out.responseText).toBe('Vale, te ayudo con eso.');
    expect(out.handoff).toBe(false);
    expect(out.urgent).toBe(false);
    expect(out.toolsCalled).toEqual([]);
    expect(out.tokensIn).toBe(120);
    expect(out.tokensOut).toBe(8);
    expect(out.model).toBe('gemini-flash-latest');
    expect(mocks.callLLM).toHaveBeenCalledTimes(1);
  });

  it('LLM llama check_availability y luego responde → intent=SCHEDULING', async () => {
    mocks.callLLM
      .mockResolvedValueOnce({
        text: null,
        toolCalls: [
          {
            id: 'call-1',
            name: 'check_availability',
            args: { treatment_name: 'Limpieza', preferred_date: '2026-05-22' },
          },
        ],
        tokensIn: 200,
        tokensOut: 10,
        model: 'gemini-flash-latest',
        latencyMs: 600,
        fallbackUsed: false,
      })
      .mockResolvedValueOnce({
        text: 'Tengo hueco el lunes a las 10:00. ¿Te va bien?',
        toolCalls: [],
        tokensIn: 80,
        tokensOut: 18,
        model: 'gemini-flash-latest',
        latencyMs: 500,
        fallbackUsed: false,
      });

    mocks.executeAgentTool.mockResolvedValueOnce({
      name: 'check_availability',
      args: { treatment_name: 'Limpieza', preferred_date: '2026-05-22' },
      ok: true,
      result: 'Horarios disponibles: lunes 10:00',
      latencyMs: 150,
    });

    const out = await runWhatsappAgent(baseInput());

    expect(out.intent).toBe('SCHEDULING');
    expect(out.intentConfidence).toBe(0.9);
    expect(out.responseText).toBe('Tengo hueco el lunes a las 10:00. ¿Te va bien?');
    expect(out.handoff).toBe(false);
    expect(out.toolsCalled).toHaveLength(1);
    expect(out.toolsCalled[0]?.name).toBe('check_availability');
    expect(out.tokensIn).toBe(280); // 200 + 80
    expect(out.tokensOut).toBe(28); // 10 + 18
  });

  it('flag_urgent → intent=URGENT + URGENT_RESPONSE_TEXT + handoff', async () => {
    mocks.callLLM.mockResolvedValueOnce({
      text: null,
      toolCalls: [
        {
          id: 'call-1',
          name: 'flag_urgent',
          args: { reason: 'sangrado intenso tras extracción' },
        },
      ],
      tokensIn: 150,
      tokensOut: 5,
      model: 'gemini-flash-latest',
      latencyMs: 700,
      fallbackUsed: false,
    });

    mocks.executeAgentTool.mockResolvedValueOnce({
      name: 'flag_urgent',
      args: { reason: 'sangrado intenso tras extracción' },
      ok: true,
      result: 'URGENT marcado',
      latencyMs: 1,
    });

    const out = await runWhatsappAgent({
      ...baseInput(),
      userText: 'Llevo sangrando 3 horas, no para',
    });

    expect(out.intent).toBe('URGENT');
    expect(out.urgent).toBe(true);
    expect(out.handoff).toBe(true);
    expect(out.responseText).toBe(URGENT_RESPONSE_TEXT);
    expect(out.intentConfidence).toBe(1.0);
    // El LLM no se llamó una segunda vez: terminamos al detectar la tool terminal.
    expect(mocks.callLLM).toHaveBeenCalledTimes(1);
  });

  it('request_handoff → intent=HANDOFF + HANDOFF_RESPONSE_TEXT', async () => {
    mocks.callLLM.mockResolvedValueOnce({
      text: null,
      toolCalls: [
        {
          id: 'call-1',
          name: 'request_handoff',
          args: { reason: 'paciente quiere hablar con el Dr. García' },
        },
      ],
      tokensIn: 90,
      tokensOut: 5,
      model: 'gemini-flash-latest',
      latencyMs: 300,
      fallbackUsed: false,
    });

    mocks.executeAgentTool.mockResolvedValueOnce({
      name: 'request_handoff',
      args: { reason: 'paciente quiere hablar con el Dr. García' },
      ok: true,
      result: 'HANDOFF marcado',
      latencyMs: 1,
    });

    const out = await runWhatsappAgent(baseInput());

    expect(out.intent).toBe('HANDOFF');
    expect(out.handoff).toBe(true);
    expect(out.urgent).toBe(false);
    expect(out.responseText).toBe(HANDOFF_RESPONSE_TEXT);
  });

  it('fallbackUsed se propaga si alguna vuelta usó OpenAI', async () => {
    mocks.callLLM
      .mockResolvedValueOnce({
        text: null,
        toolCalls: [{ id: 'c1', name: 'search_faqs', args: { query: 'parking' } }],
        tokensIn: 50,
        tokensOut: 3,
        model: 'gpt-4o-mini',
        latencyMs: 400,
        fallbackUsed: true,
      })
      .mockResolvedValueOnce({
        text: 'Tenemos parking en la calle.',
        toolCalls: [],
        tokensIn: 20,
        tokensOut: 8,
        model: 'gemini-flash-latest',
        latencyMs: 200,
        fallbackUsed: false,
      });

    mocks.executeAgentTool.mockResolvedValueOnce({
      name: 'search_faqs',
      args: { query: 'parking' },
      ok: true,
      result: 'Parking gratis en la puerta',
      latencyMs: 10,
    });

    const out = await runWhatsappAgent(baseInput());
    expect(out.fallbackUsed).toBe(true);
    expect(out.intent).toBe('FAQ');
  });

  it('si callLLM lanza → handoff fallback + errorText', async () => {
    mocks.callLLM.mockRejectedValueOnce(new Error('Gemini 503 + OpenAI 429'));
    const out = await runWhatsappAgent(baseInput());

    expect(out.handoff).toBe(true);
    expect(out.responseText).toBe(HANDOFF_RESPONSE_TEXT);
    expect(out.errorText).toMatch(/Gemini 503/);
    expect(out.intent).toBe('HANDOFF');
  });

  it('max iterations: 5 vueltas con tools, sin texto final → handoff fallback', async () => {
    const loopResponse = {
      text: null,
      toolCalls: [{ id: 'c', name: 'search_faqs', args: { query: 'x' } }],
      tokensIn: 10,
      tokensOut: 1,
      model: 'gemini-flash-latest',
      latencyMs: 100,
      fallbackUsed: false,
    };
    mocks.callLLM.mockResolvedValue(loopResponse);
    mocks.executeAgentTool.mockResolvedValue({
      name: 'search_faqs',
      args: { query: 'x' },
      ok: true,
      result: 'ok',
      latencyMs: 1,
    });

    const out = await runWhatsappAgent(baseInput());

    expect(out.handoff).toBe(true);
    expect(out.responseText).toBe(HANDOFF_RESPONSE_TEXT);
    expect(out.errorText).toBe('max_tool_iterations_reached');
    expect(mocks.callLLM).toHaveBeenCalledTimes(5);
  });

  it('history y userText llegan a callLLM como messages user/assistant + final user', async () => {
    mocks.callLLM.mockResolvedValueOnce({
      text: 'Vale',
      toolCalls: [],
      tokensIn: 1,
      tokensOut: 1,
      model: 'gemini-flash-latest',
      latencyMs: 1,
      fallbackUsed: false,
    });

    await runWhatsappAgent({
      ...baseInput(),
      history: [
        { role: 'user', content: 'hola' },
        { role: 'assistant', content: 'buenas, ¿en qué te ayudo?' },
      ],
      userText: 'quiero limpieza',
    });

    const callArgs = mocks.callLLM.mock.calls[0]?.[0];
    expect(callArgs.messages[0]).toEqual({ role: 'system', content: 'SYSTEM_PROMPT_STUB' });
    expect(callArgs.messages[1]).toEqual({ role: 'user', content: 'hola' });
    expect(callArgs.messages[2]).toEqual({
      role: 'assistant',
      content: 'buenas, ¿en qué te ayudo?',
    });
    expect(callArgs.messages[3]).toEqual({ role: 'user', content: 'quiero limpieza' });
  });
});
