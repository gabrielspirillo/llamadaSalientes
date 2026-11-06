import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Mock del SDK de OpenAI al estilo singleton del cliente. Evita tocar la red.
const openaiCreate = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: openaiCreate } };
  },
}));

import { LlmError, callLLM } from '@/lib/whatsapp/agent/llm';
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

beforeEach(() => {
  openaiCreate.mockReset();
  process.env.OPENAI_API_KEY = 'fake-openai-key';
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('callLLM — OpenAI (único proveedor)', () => {
  it('parsea texto puro y devuelve toolCalls vacío + token counts', async () => {
    openaiCreate.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'Vale, te ayudo con eso.' } }],
      usage: { prompt_tokens: 120, completion_tokens: 8 },
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
    expect(out.model).toBe('gpt-5.4');
    // Las tools van declaradas como funciones, con el schema tal cual.
    const body = openaiCreate.mock.calls[0]?.[0] as {
      model: string;
      tools: Array<{ type: string; function: { name: string } }>;
    };
    expect(body.model).toBe('gpt-5.4');
    expect(body.tools[0]?.function.name).toBe('check_availability');
  });

  it('parsea tool_calls y deserializa los args', async () => {
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
    });

    expect(out.text).toBeNull();
    expect(out.toolCalls).toEqual([
      {
        id: 'call_abc',
        name: 'check_availability',
        args: { treatment_name: 'Limpieza', preferred_date: '2026-05-22' },
      },
    ]);
  });

  it('si el modelo rechaza la temperatura (400), reintenta sin ella', async () => {
    openaiCreate
      .mockRejectedValueOnce(
        Object.assign(new Error("Unsupported value: 'temperature' does not support 0.3"), {
          status: 400,
        }),
      )
      .mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });

    const out = await callLLM({
      messages: [{ role: 'user', content: 'hola' }],
      tools: [],
      temperature: 0.3,
    });

    expect(out.text).toBe('ok');
    expect(openaiCreate).toHaveBeenCalledTimes(2);
    expect('temperature' in (openaiCreate.mock.calls[0]?.[0] as object)).toBe(true);
    expect('temperature' in (openaiCreate.mock.calls[1]?.[0] as object)).toBe(false);
  });

  it('un 500 sube como LlmError reintentable; un 400 no', async () => {
    openaiCreate.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    await expect(
      callLLM({ messages: [{ role: 'user', content: 'hola' }], tools: [] }),
    ).rejects.toMatchObject({ name: 'LlmError', retryable: true, provider: 'openai' });

    openaiCreate.mockRejectedValueOnce(Object.assign(new Error('bad request'), { status: 400 }));
    await expect(
      callLLM({ messages: [{ role: 'user', content: 'hola' }], tools: [] }),
    ).rejects.toSatisfy((e: unknown) => e instanceof LlmError && !e.retryable);
  });
});
