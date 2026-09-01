import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { badRequest, messagingErrorResponse } from '@/lib/messaging/api';
import {
  MessagingNotFoundError,
  requireChannelMember,
  requireMessagingRole,
} from '@/lib/messaging/auth';
import { MAX_BODY_LENGTH } from '@/lib/messaging/constants';
import { loadMessage } from '@/lib/messaging/queries';
import { deleteMessage, editMessage } from '@/lib/messaging/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();
const patchSchema = z.object({ body: z.string().trim().min(1).max(MAX_BODY_LENGTH) });

/** Editar. La ventana de 15 min y la autoría las valida `editMessage`. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const { id } = await params;
    if (!idSchema.safeParse(id).success) throw new MessagingNotFoundError('Mensaje');

    const message = await loadMessage(auth.tenantId, id, auth.userId);
    if (!message) throw new MessagingNotFoundError('Mensaje');
    await requireChannelMember(auth, message.channelId);

    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);

    await editMessage({
      tenantId: auth.tenantId,
      messageId: id,
      userId: auth.userId,
      body: parsed.data.body,
    });
    const updated = await loadMessage(auth.tenantId, id, auth.userId);
    return NextResponse.json({ message: updated });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}

/** Borrado blando: el mensaje queda como "eliminado" y conserva la auditoría. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const { id } = await params;
    if (!idSchema.safeParse(id).success) throw new MessagingNotFoundError('Mensaje');

    const message = await loadMessage(auth.tenantId, id, auth.userId);
    if (!message) throw new MessagingNotFoundError('Mensaje');
    await requireChannelMember(auth, message.channelId);

    await deleteMessage({
      tenantId: auth.tenantId,
      messageId: id,
      userId: auth.userId,
      isAdmin: auth.role === 'admin',
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}
