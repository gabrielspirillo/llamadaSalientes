import { type NextRequest, NextResponse } from 'next/server';

import { badRequest, reorderSchema, taskErrorResponse } from '@/lib/tasks/api';
import { requireTaskRole } from '@/lib/tasks/auth';
import { reorderColumn } from '@/lib/tasks/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** El cliente manda el orden final de la columna después del drag. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('operator');
    const parsed = reorderSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);

    const res = await reorderColumn({
      tenantId: auth.tenantId,
      status: parsed.data.status,
      orderedIds: parsed.data.orderedIds,
      actorUserId: auth.userId,
    });
    if (res.blocked.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          blocked: res.blocked,
          error: `Estas tareas exigen evidencia para cerrarse: ${res.blocked
            .map((b) => b.title)
            .join(', ')}`,
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return taskErrorResponse(err);
  }
}
