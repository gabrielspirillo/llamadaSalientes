import { isUuid } from '@/lib/agenda/appointment-ref';
import { type NextRequest, NextResponse } from 'next/server';

import { badRequest, taskErrorResponse, updateTaskSchema } from '@/lib/tasks/api';
import { requireTaskRole } from '@/lib/tasks/auth';
import { loadTaskDetail } from '@/lib/tasks/queries';
import { archiveTask, updateTask } from '@/lib/tasks/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('viewer');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 });
    const task = await loadTaskDetail(auth.tenantId, id);
    if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 });
    return NextResponse.json({ task });
  } catch (err) {
    return taskErrorResponse(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('operator');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 });
    const parsed = updateTaskSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);

    await updateTask({
      tenantId: auth.tenantId,
      taskId: id,
      actorUserId: auth.userId,
      ...parsed.data,
    });
    const task = await loadTaskDetail(auth.tenantId, id);
    return NextResponse.json({ task });
  } catch (err) {
    return taskErrorResponse(err);
  }
}

/** Archivar, no borrar: el histórico de cumplimiento tiene que sobrevivir. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('operator');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 });
    await archiveTask({ tenantId: auth.tenantId, taskId: id, actorUserId: auth.userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return taskErrorResponse(err);
  }
}
