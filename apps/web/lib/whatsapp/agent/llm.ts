import 'server-only';
import OpenAI from 'openai';

import { OPENAI_MODEL } from '@/lib/openai/model';

/**
 * Cliente LLM con tool-calling para el asistente de WhatsApp y el entrenador.
 *
 * Un solo proveedor: OpenAI, modelo `OPENAI_MODEL` (gpt-5.4). Gemini se quitó
 * del todo el 6/11/2026 a pedido de la clínica (fallaba al interpretar). Si
 * OpenAI falla, el error sube con `retryable` y el job reintenta.
 *
 * API mínima: `callLLM` ejecuta UNA vuelta. El orquestador hace el loop
 * tool-calling externo para tener control granular sobre las trazas y el
 * corte por terminal-tools (request_handoff / flag_urgent).
 *
 * Mensajes:
 *   - system / user / assistant: lo habitual.
 *   - assistant con tool_calls: cuando reentregamos al LLM lo que él dijo
 *     en una vuelta previa.
 *   - tool: resultado de ejecutar una tool, identificado por toolCallId.
 */

const REQUEST_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 20_000);

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────────────────────

export interface LlmToolCallRequest {
  /** ID único de esta invocación (lo genera el provider). */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: LlmToolCallRequest[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

/**
 * Una herramienta tal como se declara al proveedor.
 *
 * No es `AgentToolDefinition`: el mismo cliente lo usa el entrenador del
 * asistente (`lib/agent-training/coach.ts`), que tiene su propia herramienta y
 * no ejecuta ninguna de las del agente. `AgentToolDefinition` encaja aquí por
 * estructura.
 */
export interface LlmToolDefinition {
  name: string;
  description: string;
  /** JSON Schema draft-07 compatible. Sin $schema ni $id. */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };
}

export interface LlmCallInput {
  messages: LlmMessage[];
  tools: LlmToolDefinition[];
  temperature?: number;
}

export interface LlmCallResult {
  /** Texto final si el LLM no llamó a más tools. Null si solo pidió tools. */
  text: string | null;
  toolCalls: LlmToolCallRequest[];
  tokensIn: number;
  tokensOut: number;
  model: string;
  latencyMs: number;
  /** Siempre false: ya no hay proveedor de respaldo. Se conserva por las trazas guardadas. */
  fallbackUsed: boolean;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly provider: 'openai',
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrypoint
// ─────────────────────────────────────────────────────────────────────────────

export async function callLLM(input: LlmCallInput): Promise<LlmCallResult> {
  return callOpenAI(input);
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI provider
// ─────────────────────────────────────────────────────────────────────────────

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new LlmError('OPENAI_API_KEY no configurada', 'openai', undefined, false);
  }
  // Sin reintentos del SDK: el job de la cola ya reintenta, y dos reintentos
  // encadenados dejaban al paciente minutos sin respuesta.
  _openai = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 });
  return _openai;
}

async function callOpenAI(input: LlmCallInput): Promise<LlmCallResult> {
  const openai = getOpenAI();
  const model = OPENAI_MODEL;
  const started = Date.now();

  const messages = toOpenAIMessages(input.messages);
  const tools = input.tools.length
    ? input.tools.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
    : undefined;

  let completion: Awaited<ReturnType<typeof openai.chat.completions.create>>;
  const create = (withTemperature: boolean) =>
    openai.chat.completions.create(
      {
        model,
        ...(withTemperature ? { temperature: input.temperature ?? 0.3 } : {}),
        messages,
        tools,
      },
      { timeout: REQUEST_TIMEOUT_MS },
    );
  try {
    try {
      completion = await create(true);
    } catch (err) {
      // Algunos modelos de OpenAI sólo aceptan la temperatura por defecto:
      // sin esto, cambiar de modelo dejaba al asistente mudo.
      const status = (err as { status?: number }).status;
      if (status !== 400 || !/temperature/i.test((err as Error).message ?? '')) throw err;
      completion = await create(false);
    }
  } catch (err) {
    const status = (err as { status?: number }).status;
    const retryable = !status || status === 429 || status >= 500;
    throw new LlmError(
      `OpenAI ${status ?? '?'}: ${(err as Error).message}`,
      'openai',
      status,
      retryable,
    );
  }

  const choice = completion.choices[0];
  const message = choice?.message;
  const latencyMs = Date.now() - started;

  const toolCalls: LlmToolCallRequest[] = [];
  if (message?.tool_calls) {
    for (const tc of message.tool_calls) {
      if (tc.type !== 'function') continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
      } catch {
        args = { _raw: tc.function.arguments };
      }
      toolCalls.push({ id: tc.id, name: tc.function.name, args });
    }
  }

  const text = (message?.content ?? '').trim();
  return {
    text: text.length ? text : null,
    toolCalls,
    tokensIn: completion.usage?.prompt_tokens ?? 0,
    tokensOut: completion.usage?.completion_tokens ?? 0,
    model,
    latencyMs,
    fallbackUsed: false,
  };
}

type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function toOpenAIMessages(messages: LlmMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      out.push({ role: 'system', content: msg.content });
      continue;
    }
    if (msg.role === 'user') {
      out.push({ role: 'user', content: msg.content });
      continue;
    }
    if (msg.role === 'assistant') {
      const base: OpenAIMessage = {
        role: 'assistant',
        content: msg.content ?? '',
      };
      if (msg.toolCalls?.length) {
        (base as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam).tool_calls =
          msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
          }));
      }
      out.push(base);
      continue;
    }
    if (msg.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: msg.toolCallId,
        content: msg.content,
      });
    }
  }
  return out;
}
