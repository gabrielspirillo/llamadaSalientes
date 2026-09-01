import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { badRequest, messagingErrorResponse } from '@/lib/messaging/api';
import {
  MessagingNotFoundError,
  requireChannelMember,
  requireMessagingRole,
} from '@/lib/messaging/auth';
import { loadMessage } from '@/lib/messaging/queries';
import { toggleReaction } from '@/lib/messaging/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// No se restringe a REACTION_EMOJIS: esa constante es la barra rápida, no el
// universo. Sí se acota el largo y se prohíben espacios para que nadie use la
// tabla de reacciones como campo de texto libre.
const schema = z.object({
  emoji: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .refine((v) => !/\s/.test(v), { message: 'Emoji inválido' }),
});

/** Toggle: si ya reaccioné con ese emoji, lo saca. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new MessagingNotFoundError('Mensaje');

    const message = await loadMessage(auth.tenantId, id, auth.userId);
    if (!message) throw new MessagingNotFoundError('Mensaje');
    await requireChannelMember(auth, message.channelId);

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);

    await toggleReaction({
      tenantId: auth.tenantId,
      messageId: id,
      userId: auth.userId,
      emoji: parsed.data.emoji,
    });
    const updated = await loadMessage(auth.tenantId, id, auth.userId);
    return NextResponse.json({ reactions: updated?.reactions ?? [] });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}
