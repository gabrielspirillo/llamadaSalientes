import { denyUnlessRole } from '@/lib/auth/api-guard';
import { getCurrentTenant } from '@/lib/tenant';
import { runWhatsappAgent } from '@/lib/whatsapp/agent';
import type { AgentInput } from '@/lib/whatsapp/agent/types';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Corre el agente de WhatsApp desde el panel, sin WhatsApp.
 *
 * Es el MISMO orquestador que atiende a los pacientes (`runWhatsappAgent`):
 * mismo prompt, mismo modelo, mismas tools. No es una imitación, porque una
 * imitación sólo demuestra que la imitación funciona. Lo único que cambia es
 * de dónde viene el texto y a dónde va la respuesta.
 *
 * El orquestador no escribe en la base —de eso se encarga el job que lo
 * llama—, así que la prueba no deja runs ni mensajes. Las TOOLS sí son
 * reales: si el agente reserva una cita, la cita queda. Es deliberado; un
 * banco de pruebas que no reserva no prueba la reserva.
 */
const bodySchema = z.object({
  text: z.string().trim().min(1, 'Escribe un mensaje').max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(4000),
      }),
    )
    .max(20)
    .default([]),
  /** Identifica la conversación simulada; da idempotencia a las reservas. */
  sessionId: z
    .string()
    .regex(/^[a-zA-Z0-9-]{6,64}$/, 'sessionId inválido')
    .optional(),
  /** Teléfono con el que el agente cree hablar (memoria del lead, fichas). */
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,15}$/, 'El teléfono va en formato internacional, ej. +34600111222')
    .optional(),
});

/** Teléfono por defecto de las pruebas: válido en forma, de nadie en la vida real. */
const TELEFONO_DE_PRUEBA = '+34600000000';

export async function POST(req: NextRequest) {
  // Cada turno gasta tokens del LLM y puede escribir en la agenda.
  const denied = await denyUnlessRole('operator');
  if (denied) return denied;

  let tenantId: string;
  try {
    const ctx = await getCurrentTenant();
    tenantId = ctx.tenant.id;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const primero = parsed.error.issues[0];
    return NextResponse.json(
      { error: primero?.message ?? 'Parámetros inválidos' },
      { status: 400 },
    );
  }
  const { text, history, sessionId, phone } = parsed.data;

  // El prefijo `sim-` mantiene la conversación simulada fuera del espacio de
  // ids de las reales (uuid): así su dedupe_key nunca choca con el de una
  // conversación de verdad.
  const conversationId = `sim-${sessionId ?? crypto.randomUUID()}`;

  const input: AgentInput = {
    tenantId,
    conversationId,
    contactId: conversationId,
    contactPhoneE164: phone ?? TELEFONO_DE_PRUEBA,
    userText: text,
    history,
    triggerMessageId: `${conversationId}:${Date.now()}`,
    remindersResume: null,
  };

  try {
    const out = await runWhatsappAgent(input);
    return NextResponse.json({
      conversationId,
      responseText: out.responseText,
      responseButtons: out.responseButtons,
      intent: out.intent,
      intentConfidence: out.intentConfidence,
      intentReasoning: out.intentReasoning,
      handoff: out.handoff,
      urgent: out.urgent,
      model: out.model,
      latencyMs: out.latencyMs,
      fallbackUsed: out.fallbackUsed,
      errorText: out.errorText,
      // La traza es la mitad del valor de probar: enseña QUÉ consultó el
      // agente, no sólo qué contestó.
      toolsCalled: out.toolsCalled.map((t) => ({
        name: t.name,
        args: t.args,
        ok: t.ok,
        result: t.result.slice(0, 1200),
        latencyMs: t.latencyMs,
        error: t.error ?? null,
      })),
    });
  } catch (err) {
    console.error('[agent:whatsapp-test] falló la simulación', {
      tenantId,
      err: (err as Error).message,
    });
    return NextResponse.json(
      {
        error:
          'El agente no pudo responder. Revisa que GEMINI_API_KEY / OPENAI_API_KEY estén configuradas.',
      },
      { status: 500 },
    );
  }
}
