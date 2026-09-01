import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { badRequest, messagingErrorResponse } from '@/lib/messaging/api';
import { MessagingForbiddenError, requireMessagingRole } from '@/lib/messaging/auth';
import { createChannel } from '@/lib/messaging/channels';
import { IM_TONES } from '@/lib/messaging/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Los DM y los hilos de contexto tienen sus propias rutas (son idempotentes y
// no llevan nombre); acá solo se crean canales que alguien bautiza.
const schema = z.object({
  kind: z.enum(['PUBLIC', 'PRIVATE', 'GROUP']),
  name: z.string().trim().min(1).max(80),
  // `nullish` y no `optional`: un formulario manda '' o null en los campos que
  // el usuario dejó vacíos, y `optional()` solo acepta `undefined`.
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,40}$/, 'Slug inválido')
    .nullish(),
  topic: z.string().trim().max(300).nullish(),
  icon: z.string().trim().max(40).nullish(),
  tone: z.enum(IM_TONES).nullish(),
  memberUserIds: z.array(z.string().uuid()).max(200).nullish().default([]),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('operator');
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);

    // Un canal público lo ve toda la clínica: eso lo decide un admin.
    if (parsed.data.kind === 'PUBLIC' && auth.role !== 'admin') {
      throw new MessagingForbiddenError(auth.role, 'admin');
    }

    // El creador siempre queda dentro, aunque el cliente se olvide de incluirlo.
    const memberUserIds = Array.from(new Set([...(parsed.data.memberUserIds ?? []), auth.userId]));

    const { id } = await createChannel({
      tenantId: auth.tenantId,
      kind: parsed.data.kind,
      name: parsed.data.name,
      slug: parsed.data.slug ?? null,
      topic: parsed.data.topic ?? null,
      icon: parsed.data.icon ?? null,
      tone: parsed.data.tone ?? undefined,
      createdByUserId: auth.userId,
      memberUserIds,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}
