import { type NextRequest, NextResponse } from 'next/server';

import { badRequest, createTaskSchema, taskErrorResponse } from '@/lib/tasks/api';
import { requireTaskRole } from '@/lib/tasks/auth';
import { getTenantTimezone } from '@/lib/tasks/materialize';
import { loadBoardTasks, loadTaskStats } from '@/lib/tasks/queries';
import { createTask } from '@/lib/tasks/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Tablero completo. Lo usa el refresco en vivo del cliente. */
export async function GET(): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('viewer');
    const board = await loadBoardTasks(auth.tenantId);
    const stats = await loadTaskStats(
      auth.tenantId,
      board,
      new Date(),
      await getTenantTimezone(auth.tenantId),
    );
    return NextResponse.json({ tasks: board, stats });
  } catch (err) {
    return taskErrorResponse(err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('operator');
    const parsed = createTaskSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);

    const res = await createTask({
      tenantId: auth.tenantId,
      createdByUserId: auth.userId,
      source: 'MANUAL',
      ...parsed.data,
    });
    if (!res.id) {
      return NextResponse.json({ error: 'La tarea ya existía' }, { status: 409 });
    }
    return NextResponse.json({ id: res.id }, { status: 201 });
  } catch (err) {
    return taskErrorResponse(err);
  }
}
