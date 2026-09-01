import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { badRequest, messagingErrorResponse } from '@/lib/messaging/api';
import { requireMessagingRole } from '@/lib/messaging/auth';
import { ensureContextChannel } from '@/lib/messaging/channels';
import { IM_CONTEXT_TYPES } from '@/lib/messaging/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  contextType: z.enum(IM_CONTEXT_TYPES),
  contextId: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  memberUserIds: z.array(z.string().uuid()).max(200).optional(),
});

/**
 * Hilo de una entidad del producto (paciente, llamada, tarea…). Idempotente
 * por (tenant, contextType, contextId): el botón "Comentar" siempre cae en el
 * mismo canal.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);

    const memberUserIds = Array.from(
      new Set([...(parsed.data.memberUserIds ?? []), auth.userId]),
    );

    const { id } = await ensureContextChannel({
      tenantId: auth.tenantId,
      contextType: parsed.data.contextType,
      contextId: parsed.data.contextId,
      label: parsed.data.label,
      createdByUserId: auth.userId,
      memberUserIds,
    });
    return NextResponse.json({ id });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}
