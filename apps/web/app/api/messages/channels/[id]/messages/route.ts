import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { badRequest, messagingErrorResponse } from '@/lib/messaging/api';
import {
  MessagingForbiddenError,
  MessagingNotFoundError,
  canPostIn,
  requireChannelMember,
  requireMessagingRole,
} from '@/lib/messaging/auth';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_BODY_LENGTH,
  THREAD_PAGE_SIZE,
} from '@/lib/messaging/constants';
import { loadReplies, loadThread } from '@/lib/messaging/queries';
import { sendMessage } from '@/lib/messaging/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();

const listSchema = z.object({
  before: z.string().datetime({ offset: true }).nullish(),
  limit: z.coerce.number().int().min(1).max(100).default(THREAD_PAGE_SIZE),
  // Con `parentId` la ruta devuelve las respuestas de ESE mensaje, no la página
  // del canal. Sin esta rama el panel de hilo recibía el canal entero y lo
  // pintaba como si fueran respuestas.
  parentId: z.string().uuid().nullish(),
});

/** Página keyset del hilo. `before` es el ISO del mensaje más viejo ya visto. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const { id } = await params;
    if (!idSchema.safeParse(id).success) throw new MessagingNotFoundError('Canal');

    await requireChannelMember(auth, id);

    const parsed = listSchema.safeParse({
      before: req.nextUrl.searchParams.get('before') ?? undefined,
      limit: req.nextUrl.searchParams.get('limit') ?? undefined,
      parentId: req.nextUrl.searchParams.get('parentId') ?? undefined,
    });
    if (!parsed.success) return badRequest(parsed.error.issues);

    // Respuestas de un mensaje. Se devuelven con la misma forma que una página
    // del hilo para que el cliente no tenga que ramificar el parseo.
    if (parsed.data.parentId) {
      const replies = await loadReplies({
        tenantId: auth.tenantId,
        parentId: parsed.data.parentId,
        userId: auth.userId,
      });
      return NextResponse.json({ messages: replies, nextCursor: null, hasMore: false });
    }

    const page = await loadThread({
      tenantId: auth.tenantId,
      channelId: id,
      userId: auth.userId,
      before: parsed.data.before ?? null,
      limit: parsed.data.limit,
    });
    return NextResponse.json(page);
  } catch (err) {
    return messagingErrorResponse(err);
  }
}

// Los adjuntos ya pasaron por POST /api/messages/attachments; acá solo se
// re-valida la forma de la referencia, nunca se confía en una URL del cliente.
const attachmentSchema = z.object({
  key: z.string().trim().min(1).max(400),
  name: z.string().trim().min(1).max(255),
  mime: z.string().trim().min(1).max(160),
  size: z.number().int().min(0),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const postSchema = z
  .object({
    body: z.string().max(MAX_BODY_LENGTH).default(''),
    clientNonce: z.string().trim().max(80).optional(),
    parentId: z.string().uuid().optional(),
    attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS_PER_MESSAGE).default([]),
  })
  .refine((v) => v.body.trim().length > 0 || v.attachments.length > 0, {
    message: 'El mensaje está vacío',
    path: ['body'],
  });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const { id } = await params;
    if (!idSchema.safeParse(id).success) throw new MessagingNotFoundError('Canal');

    const member = await requireChannelMember(auth, id);
    // Un viewer coordina por DM y grupos, pero no publica en canales de operación.
    if (!canPostIn(auth.role, member.kind)) {
      throw new MessagingForbiddenError(auth.role, 'operator');
    }

    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);

    const res = await sendMessage({
      tenantId: auth.tenantId,
      channelId: id,
      senderUserId: auth.userId,
      senderKind: 'USER',
      kind: 'TEXT',
      body: parsed.data.body.trim(),
      parentId: parsed.data.parentId ?? null,
      attachments: parsed.data.attachments,
      clientNonce: parsed.data.clientNonce ?? null,
    });
    return NextResponse.json(res, { status: 201 });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}
