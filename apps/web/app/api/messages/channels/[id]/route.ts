import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { badRequest, messagingErrorResponse } from '@/lib/messaging/api';
import {
  MessagingNotFoundError,
  requireChannelManager,
  requireChannelMember,
  requireMessagingRole,
} from '@/lib/messaging/auth';
import { setMemberPrefs, updateChannel } from '@/lib/messaging/channels';
import { IM_TONES } from '@/lib/messaging/constants';
import { loadChannel } from '@/lib/messaging/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();

/** Metadatos del canal ya resueltos para quien pide (no leídos, rol, miembros). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const { id } = await params;
    if (!idSchema.safeParse(id).success) throw new MessagingNotFoundError('Canal');

    await requireChannelMember(auth, id);
    const channel = await loadChannel(auth.tenantId, id, auth.userId);
    if (!channel) throw new MessagingNotFoundError('Canal');
    return NextResponse.json({ channel });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}

// Dos cosas distintas viajan en el mismo PATCH: lo que es del canal (y necesita
// ser OWNER/admin) y lo que es de mi membresía (silenciar, fijar en el rail),
// que cualquier miembro puede tocar sobre sí mismo.
const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).nullable().optional(),
    topic: z.string().trim().max(300).nullable().optional(),
    icon: z.string().trim().max(40).nullable().optional(),
    tone: z.enum(IM_TONES).optional(),
    archived: z.boolean().optional(),
    muted: z.boolean().optional(),
    pinned: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada que actualizar' });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const { id } = await params;
    if (!idSchema.safeParse(id).success) throw new MessagingNotFoundError('Canal');

    await requireChannelMember(auth, id);

    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);
    const { muted, pinned, ...channelPatch } = parsed.data;

    const touchesChannel = Object.values(channelPatch).some((v) => v !== undefined);
    if (touchesChannel) {
      await requireChannelManager(auth, id);
      await updateChannel({ tenantId: auth.tenantId, channelId: id, patch: channelPatch });
    }

    if (muted !== undefined || pinned !== undefined) {
      await setMemberPrefs({
        tenantId: auth.tenantId,
        channelId: id,
        userId: auth.userId,
        muted,
        pinned,
      });
    }

    const channel = await loadChannel(auth.tenantId, id, auth.userId);
    if (!channel) throw new MessagingNotFoundError('Canal');
    return NextResponse.json({ channel });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}
