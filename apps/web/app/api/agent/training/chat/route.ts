import { runCoach } from '@/lib/agent-training/coach';
import { appendTrainingMessage, listRecentTrainingTurns } from '@/lib/agent-training/lessons';
import { denyUnlessRole } from '@/lib/auth/api-guard';
import { getCurrentTenant } from '@/lib/tenant';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Un turno de la conversación de entrenamiento.
 *
 * El historial NO viene del cliente: se lee de la base. La conversación está
 * guardada de todos modos (una clínica entrena en varios ratos) y así el
 * contexto que ve el entrenador es el mismo que la persona tiene delante, sin
 * depender de lo que el navegador decida mandar.
 */
const bodySchema = z.object({
  text: z.string().trim().min(2, 'Cuéntame un poco más').max(2000),
});

export async function POST(req: NextRequest) {
  // Cada turno gasta tokens del LLM y deja enseñanzas propuestas.
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Parámetros inválidos' },
      { status: 400 },
    );
  }
  const { text } = parsed.data;

  try {
    const history = await listRecentTrainingTurns(tenantId);
    // El mensaje de la persona se guarda ANTES de llamar al modelo: si el
    // modelo falla, lo que escribió no se pierde.
    const userMessage = await appendTrainingMessage({ tenantId, role: 'user', content: text });

    const result = await runCoach({
      tenantId,
      history,
      userText: text,
      // El prefijo de la propuesta tiene que ser estable y único dentro del
      // turno: es lo que identifica la tarjeta al aplicarla.
      refPrefix: userMessage.id,
    });

    const coachMessage = await appendTrainingMessage({
      tenantId,
      role: 'assistant',
      content: result.reply,
      proposals: result.proposals,
    });

    return NextResponse.json({
      userMessage: { id: userMessage.id, content: userMessage.content },
      reply: {
        id: coachMessage.id,
        content: coachMessage.content,
        proposals: coachMessage.proposals,
      },
      model: result.model,
    });
  } catch (err) {
    console.error('[agent:training] el entrenador no pudo responder', {
      tenantId,
      err: (err as Error).message,
    });
    return NextResponse.json(
      {
        error: 'El entrenador no ha podido responder. Vuelve a intentarlo en un momento.',
      },
      { status: 500 },
    );
  }
}
