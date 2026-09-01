import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { badRequest, messagingErrorResponse } from '@/lib/messaging/api';
import { requireMessagingRole } from '@/lib/messaging/auth';
import { searchMessages } from '@/lib/messaging/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  q: z.string().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * Búsqueda FTS acotada a los canales del usuario. Con menos de dos caracteres
 * no se consulta la base: el Cmd-K dispara en cada tecla.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const parsed = querySchema.safeParse({
      q: req.nextUrl.searchParams.get('q') ?? '',
      limit: req.nextUrl.searchParams.get('limit') ?? undefined,
    });
    if (!parsed.success) return badRequest(parsed.error.issues);

    const q = parsed.data.q.trim();
    if (q.length < 2) return NextResponse.json({ hits: [] });

    const hits = await searchMessages(auth.tenantId, auth.userId, q, parsed.data.limit);
    return NextResponse.json({ hits });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}
