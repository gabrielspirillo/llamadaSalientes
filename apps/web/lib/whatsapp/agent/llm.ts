import 'server-only';
import OpenAI from 'openai';

import type { AgentToolDefinition } from './tools';

/**
 * Cliente LLM con tool-calling para el agente de WhatsApp.
 *
 * Provider primario: Gemini (REST `generateContent`). Fallback automático a
 * OpenAI ante errores 5xx, 429, timeout o safety filter (400 con bloqueo).
 *
 * API mínima: `callLLM` ejecuta UNA vuelta. El orquestador (F4) hace el
 * loop tool-calling externo para tener control granular sobre las trazas y
 * el corte por terminal-tools (request_handoff / flag_urgent).
 *
 * Mensajes:
 *   - system / user / assistant: lo habitual.
 *   - assistant con tool_calls: cuando reentregamos al LLM lo que él dijo
 *     en una vuelta previa.
 *   - tool: resultado de ejecutar una tool, identificado por toolCallId.
 *
 * Convertimos a/desde el shape específico de cada provider internamente.
 */

const GEMINI_DEFAULT_MODEL = process.env.GEMINI_AGENT_MODEL ?? 'gemini-flash-latest';
const OPENAI_FALLBACK_MODEL = process.env.OPENAI_AGENT_FALLBACK_MODEL ?? 'gpt-4o-mini';
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

export interface LlmCallInput {
  messages: LlmMessage[];
  tools: AgentToolDefinition[];
  temperature?: number;
  /** Forzar provider (saltarse Gemini). Útil para testing/diagnóstico. */
  forceProvider?: 'gemini' | 'openai';
}

export interface LlmCallResult {
  /** Texto final si el LLM no llamó a más tools. Null si solo pidió tools. */
  text: string | null;
  toolCalls: LlmToolCallRequest[];
  tokensIn: number;
  tokensOut: number;
  model: string;
  latencyMs: number;
  fallbackUsed: boolean;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly provider: 'gemini' | 'openai',
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrypoint con fallback chain
// ─────────────────────────────────────────────────────────────────────────────

export async function callLLM(input: LlmCallInput): Promise<LlmCallResult> {
  const force = input.forceProvider;
  const useGemini = force === 'gemini' || (!force && !!process.env.GEMINI_API_KEY);
  const useOpenai = !!process.env.OPENAI_API_KEY;

  if (useGemini) {
    try {
      return await callGemini(input);
    } catch (err) {
      const e = err as LlmError;
      const retryable = e instanceof LlmError ? e.retryable : true;
      if (!useOpenai || !retryable) throw err;
      console.warn('[wa-agent-llm] Gemini falló, hago fallback a OpenAI', {
        status: e.status,
        message: e.message?.slice(0, 200),
      });
    }
  }

  if (!useOpenai) {
    throw new LlmError(
      'Ningún proveedor LLM configurado (GEMINI_API_KEY u OPENAI_API_KEY).',
      'openai',
      undefined,
      false,
    );
  }

  const result = await callOpenAI(input);
  return { ...result, fallbackUsed: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini provider (REST generateContent)
// ─────────────────────────────────────────────────────────────────────────────

type GeminiContent = {
  role: 'user' | 'model' | 'function';
  parts: Array<
    | { text: string }
    | { functionCall: { name: string; args: Record<string, unknown> } }
    | { functionResponse: { name: string; response: { content: string } } }
  >;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: GeminiContent;
    finishReason?: string;
    safetyRatings?: unknown;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

async function callGemini(input: LlmCallInput): Promise<LlmCallResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new LlmError('GEMINI_API_KEY no configurada', 'gemini', undefined, false);
  }

  const model = GEMINI_DEFAULT_MODEL;
  const { systemInstruction, contents } = toGeminiContents(input.messages);
  const body = {
    systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
    contents,
    tools: input.tools.length
      ? [
          {
            functionDeclarations: input.tools.map((t) => ({
              name: t.name,
              description: t.description,
              // Gemini acepta un subset de JSON Schema: rechaza
              // `additionalProperties`, `$schema`, `$id` con 400. OpenAI sí
              // los acepta, así que mantenemos el shape original en
              // `t.parameters` y sanitizamos solo aquí.
              parameters: sanitizeJsonSchemaForGemini(t.parameters),
            })),
          },
        ]
      : undefined,
    toolConfig: input.tools.length ? { functionCallingConfig: { mode: 'AUTO' } } : undefined,
    generationConfig: {
      temperature: input.temperature ?? 0.3,
    },
  };

  const started = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    const retryable =
      res.status === 429 ||
      res.status >= 500 ||
      (res.status === 400 && /safety|block/i.test(errBody));
    throw new LlmError(
      `Gemini ${res.status}: ${errBody.slice(0, 200)}`,
      'gemini',
      res.status,
      retryable,
    );
  }

  const data = (await res.json()) as GeminiResponse;
  const latencyMs = Date.now() - started;

  if (data.promptFeedback?.blockReason) {
    // Safety filter cortó la generación: lo tratamos como retryable para
    // que el fallback a OpenAI lo recoja.
    throw new LlmError(
      `Gemini bloqueado por safety: ${data.promptFeedback.blockReason}`,
      'gemini',
      400,
      true,
    );
  }

  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];

  const toolCalls: LlmToolCallRequest[] = [];
  const textChunks: string[] = [];
  let toolCallCounter = 0;
  for (const part of parts) {
    if ('functionCall' in part && part.functionCall) {
      toolCalls.push({
        id: `gemini-${started}-${toolCallCounter++}`,
        name: part.functionCall.name,
        args: (part.functionCall.args ?? {}) as Record<string, unknown>,
      });
    } else if ('text' in part && part.text) {
      textChunks.push(part.text);
    }
  }

  const text = textChunks.join('').trim();
  return {
    text: text.length ? text : null,
    toolCalls,
    tokensIn: data.usageMetadata?.promptTokenCount ?? 0,
    tokensOut: data.usageMetadata?.candidatesTokenCount ?? 0,
    model,
    latencyMs,
    fallbackUsed: false,
  };
}

function toGeminiContents(messages: LlmMessage[]): {
  systemInstruction: string | null;
  contents: GeminiContent[];
} {
  // Gemini admite UN systemInstruction al nivel raíz, no inline. Si vienen
  // varios `system` (raro), los concatenamos.
  const systemBuf: string[] = [];
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemBuf.push(msg.content);
      continue;
    }
    if (msg.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: msg.content }] });
      continue;
    }
    if (msg.role === 'assistant') {
      const parts: GeminiContent['parts'] = [];
      if (msg.content) parts.push({ text: msg.content });
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: tc.args } });
        }
      }
      if (parts.length === 0) parts.push({ text: '' });
      contents.push({ role: 'model', parts });
      continue;
    }
    if (msg.role === 'tool') {
      contents.push({
        role: 'function',
        parts: [
          {
            functionResponse: {
              name: msg.name,
              response: { content: msg.content },
            },
          },
        ],
      });
    }
  }

  return {
    systemInstruction: systemBuf.length ? systemBuf.join('\n\n') : null,
    contents,
  };
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
  _openai = new OpenAI({ apiKey });
  return _openai;
}

async function callOpenAI(input: LlmCallInput): Promise<LlmCallResult> {
  const openai = getOpenAI();
  const model = OPENAI_FALLBACK_MODEL;
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
  try {
    completion = await openai.chat.completions.create(
      {
        model,
        temperature: input.temperature ?? 0.3,
        messages,
        tools,
      },
      { timeout: REQUEST_TIMEOUT_MS },
    );
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gemini admite un subset de JSON Schema en `functionDeclarations.parameters`:
 * rechaza propiedades como `additionalProperties`, `$schema`, `$id` con 400
 * "Unknown name ... Cannot find field". Las eliminamos recursivamente. OpenAI
 * sí las acepta, así que la sanitización solo corre en la rama de Gemini.
 */
const GEMINI_DROP_KEYS = new Set(['additionalProperties', '$schema', '$id']);

function sanitizeJsonSchemaForGemini(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeJsonSchemaForGemini);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (GEMINI_DROP_KEYS.has(k)) continue;
      out[k] = sanitizeJsonSchemaForGemini(v);
    }
    return out;
  }
  return value;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new LlmError('LLM request timeout', 'gemini', undefined, true);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
