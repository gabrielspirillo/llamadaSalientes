import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Mock OpenAI SDK al estilo singleton del cliente. Evita tocar la red.
const openaiCreate = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: openaiCreate } };
  },
}));

import { callLLM } from '@/lib/whatsapp/agent/llm';
import type { AgentToolDefinition } from '@/lib/whatsapp/agent/tools';

const TOOL_DEFS: AgentToolDefinition[] = [
  {
    name: 'check_availability',
    description: 'd1',
    parameters: {
      type: 'object',
      properties: {
        treatment_name: { type: 'string' },
        preferred_date: { type: 'string' },
      },
      required: ['treatment_name', 'preferred_date'],
      additionalProperties: false,
    },
  },
];

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  openaiCreate.mockReset();
  process.env.GEMINI_API_KEY = 'fake-gemini-key';
  process.env.OPENAI_API_KEY = 'fake-openai-key';
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

function mockFetchOnce(response: { status?: number; body: unknown; bodyText?: string }) {
  const status = response.status ?? 200;
  globalThis.fetch = vi.fn(async () => {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => response.bodyText ?? JSON.stringify(response.body),
      json: async () => response.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('callLLM — Gemini', () => {
  it('parsea texto puro y devuelve toolCalls vacío + token counts', async () => {
    mockFetchOnce({
      body: {
        candidates: [{ content: { role: 'model', parts: [{ text: 'Vale, te ayudo con eso.' }] } }],
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 8 },
      },
    });

    const out = await callLLM({
      messages: [
        { role: 'system', content: 'Eres asistente' },
        { role: 'user', content: 'Hola' },
      ],
      tools: TOOL_DEFS,
    });

    expect(out.text).toBe('Vale, te ayudo con eso.');
    expect(out.toolCalls).toEqual([]);
    expect(out.tokensIn).toBe(120);
    expect(out.tokensOut).toBe(8);
    expect(out.fallbackUsed).toBe(false);
    expect(out.model).toMatch(/^gemini/);
  });

  it('parsea functionCall y lo expone como toolCalls', async () => {
    mockFetchOnce({
      body: {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'check_availability',
                    args: { treatment_name: 'Limpieza', preferred_date: '2026-05-22' },
                  },
                },
              ],
            },
          },
        ],
      },
    });

    const out = await callLLM({
      messages: [{ role: 'user', content: '¿Hay hueco para limpieza?' }],
      tools: TOOL_DEFS,
    });

    expect(out.text).toBeNull();
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0]).toMatchObject({
      name: 'check_availability',
      args: { treatment_name: 'Limpieza', preferred_date: '2026-05-22' },
    });
    expect(out.toolCalls[0]?.id).toMatch(/^gemini-/);
  });
});

describe('callLLM — Fallback Gemini → OpenAI', () => {
  it('si Gemini devuelve 500, hace fallback a OpenAI y marca fallbackUsed=true', async () => {
    mockFetchOnce({ status: 500, body: {}, bodyText: 'internal' });
    openaiCreate.mockResolvedValue({
      choices: [
        {
          message: { role: 'assistant', content: 'Te paso con recepción.' },
        },
      ],
      usage: { prompt_tokens: 50, completion_tokens: 6 },
    });

    const out = await callLLM({
      messages: [{ role: 'user', content: 'hola' }],
      tools: TOOL_DEFS,
    });

    expect(out.fallbackUsed).toBe(true);
    expect(out.text).toBe('Te paso con recepción.');
    expect(openaiCreate).toHaveBeenCalledTimes(1);
  });

  it('si Gemini devuelve 400 con safety block, hace fallback', async () => {
    mockFetchOnce({
      status: 400,
      body: {},
      bodyText: 'response was blocked by safety filter',
    });
    openaiCreate.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const out = await callLLM({
      messages: [{ role: 'user', content: 'foo' }],
      tools: TOOL_DEFS,
    });
    expect(out.fallbackUsed).toBe(true);
  });

  it('si Gemini devuelve 400 sin safety, NO hace fallback y propaga', async () => {
    mockFetchOnce({ status: 400, body: {}, bodyText: 'bad request, invalid model' });
    await expect(
      callLLM({
        messages: [{ role: 'user', content: 'foo' }],
        tools: TOOL_DEFS,
      }),
    ).rejects.toThrow(/Gemini 400/);
    expect(openaiCreate).not.toHaveBeenCalled();
  });
});

describe('callLLM — OpenAI tool_calls', () => {
  it('parsea tool_calls de OpenAI y deserializa los args (forceProvider)', async () => {
    openaiCreate.mockResolvedValue({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_abc',
                type: 'function',
                function: {
                  name: 'check_availability',
                  arguments: JSON.stringify({
                    treatment_name: 'Limpieza',
                    preferred_date: '2026-05-22',
                  }),
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 3 },
    });

    const out = await callLLM({
      messages: [{ role: 'user', content: 'hueco mañana' }],
      tools: TOOL_DEFS,
      forceProvider: 'openai',
    });

    expect(out.text).toBeNull();
    expect(out.toolCalls).toEqual([
      {
        id: 'call_abc',
        name: 'check_availability',
        args: { treatment_name: 'Limpieza', preferred_date: '2026-05-22' },
      },
    ]);
    // forceProvider=openai → ruta directa OpenAI, marcamos fallbackUsed=true
    // para que el orquestador sepa que no se intentó el provider primario.
    expect(out.fallbackUsed).toBe(true);
  });
});

describe('sanitizeJsonSchemaForGemini (vía cuerpo del request)', () => {
  it('elimina additionalProperties de los parameters al llamar a Gemini', async () => {
    let capturedBody: { tools?: Array<{ functionDeclarations: unknown[] }> } | null = null;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse(String((init as RequestInit).body));
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }],
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await callLLM({
      messages: [{ role: 'user', content: 'hola' }],
      tools: TOOL_DEFS,
    });

    expect(capturedBody).not.toBeNull();
    const params = (
      capturedBody as never as {
        tools: Array<{ functionDeclarations: Array<{ parameters: object }> }>;
      }
    ).tools[0]?.functionDeclarations[0]?.parameters as Record<string, unknown> | undefined;
    expect(params).toBeDefined();
    expect(params && 'additionalProperties' in params).toBe(false);
  });
});
