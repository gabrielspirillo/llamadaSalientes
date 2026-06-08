'use server';

import { z } from 'zod';

import { getCurrentTenant } from '@/lib/tenant';
import { runWhatsappAgent, type AgentRunDeps } from '@/lib/whatsapp/agent';
import { sandboxExecuteTool } from '@/lib/whatsapp/agent/sandbox-tools';

const schema = z.object({
  userText: z.string().trim().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .max(40)
    .optional(),
  // Teléfono de prueba opcional: si se pasa, carga la memoria de ese lead.
  phone: z.string().trim().max(20).optional(),
});

export type PlaygroundResult = {
  responseText: string | null;
  intent: string | null;
  handoff: boolean;
  urgent: boolean;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  intentReasoning: string | null;
  errorText: string | null;
  toolsCalled: Array<{ name: string; ok: boolean; result: string; args: Record<string, unknown> }>;
};

export type PlaygroundActionResult =
  | { success: true; data: PlaygroundResult }
  | { success: false; error: string };

export async function runAgentPlayground(input: unknown): Promise<PlaygroundActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Datos inválidos' };
  const { tenant } = await getCurrentTenant();
  const phone = parsed.data.phone?.trim() || '';

  // Deps reales (grounding/persona/LLM/RAG) salvo: tools sandbox (mutaciones
  // simuladas) y, si no hay teléfono, sin memoria de lead.
  const deps: Partial<AgentRunDeps> = { executeTool: sandboxExecuteTool };
  if (!phone) deps.loadLeadMemory = async () => null;

  try {
    const out = await runWhatsappAgent(
      {
        tenantId: tenant.id,
        conversationId: 'playground',
        contactId: 'playground',
        contactPhoneE164: phone || '+00000000000',
        userText: parsed.data.userText,
        history: parsed.data.history ?? [],
        triggerMessageId: 'playground',
        remindersResume: null,
      },
      deps,
    );
    return {
      success: true,
      data: {
        responseText: out.responseText,
        intent: out.intent,
        handoff: out.handoff,
        urgent: out.urgent,
        model: out.model,
        tokensIn: out.tokensIn,
        tokensOut: out.tokensOut,
        latencyMs: out.latencyMs,
        intentReasoning: out.intentReasoning,
        errorText: out.errorText,
        toolsCalled: out.toolsCalled.map((t) => ({
          name: t.name,
          ok: t.ok,
          result: t.result,
          args: t.args,
        })),
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
