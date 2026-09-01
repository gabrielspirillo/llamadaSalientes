import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { badRequest, messagingErrorResponse } from '@/lib/messaging/api';
import {
  MessagingNotFoundError,
  requireChannelManager,
  requireMessagingRole,
} from '@/lib/messaging/auth';
import { addMembers, removeMember } from '@/lib/messaging/channels';
import { loadChannel } from '@/lib/messaging/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z
  .object({
    add: z.array(z.string().uuid()).max(200).nullish(),
    remove: z.array(z.string().uuid()).max(200).nullish(),
  })
  .refine((v) => (v.add?.length ?? 0) + (v.remove?.length ?? 0) > 0, {
    message: 'Indicá al menos una persona a agregar o quitar',
  });

/** Invitar / expulsar. Requiere ser OWNER del canal o admin del tenant. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new MessagingNotFoundError('Canal');

    await requireChannelManager(auth, id);

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);

    const add = Array.from(new Set(parsed.data.add ?? []));
    const remove = Array.from(new Set(parsed.data.remove ?? []));

    if (add.length > 0) {
      await addMembers({ tenantId: auth.tenantId, channelId: id, userIds: add });
    }
    for (const userId of remove) {
      await removeMember({ tenantId: auth.tenantId, channelId: id, userId });
    }

    // Si me quité a mí mismo, el canal ya no existe para mí: no lo devuelvo.
    const channel = remove.includes(auth.userId)
      ? null
      : await loadChannel(auth.tenantId, id, auth.userId);
    return NextResponse.json({ channel });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}
