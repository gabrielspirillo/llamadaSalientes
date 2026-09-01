import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { badRequest, taskErrorResponse } from '@/lib/tasks/api';
import { requireTaskRole } from '@/lib/tasks/auth';
import { loadTaskDetail } from '@/lib/tasks/queries';
import { addComment } from '@/lib/tasks/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ body: z.string().trim().min(1).max(4000) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('operator');
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);

    const task = await loadTaskDetail(auth.tenantId, id);
    if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 });

    await addComment({
      tenantId: auth.tenantId,
      taskId: id,
      authorUserId: auth.userId,
      body: parsed.data.body,
    });
    return NextResponse.json({ task: await loadTaskDetail(auth.tenantId, id) }, { status: 201 });
  } catch (err) {
    return taskErrorResponse(err);
  }
}
