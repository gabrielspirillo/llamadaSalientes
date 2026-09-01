import { NextResponse } from 'next/server';
import { z } from 'zod';

import { badRequest, messagingErrorResponse } from '@/lib/messaging/api';
import { requireMessagingRole } from '@/lib/messaging/auth';
import { resolveMention } from '@/lib/messaging/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.string().uuid() });

/** Marca la mención como atendida. Solo el mencionado puede resolverla. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) return badRequest(parsed.error.issues);

    await resolveMention({
      tenantId: auth.tenantId,
      mentionId: parsed.data.id,
      userId: auth.userId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}
