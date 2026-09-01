import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { badRequest, taskErrorResponse } from '@/lib/tasks/api';
import { requireTaskRole } from '@/lib/tasks/auth';
import { loadTaskDetail } from '@/lib/tasks/queries';
import { addChecklistItem, deleteChecklistItem, setChecklistItemDone } from '@/lib/tasks/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const addSchema = z.object({ content: z.string().trim().min(1).max(300) });
const toggleSchema = z.object({ itemId: z.string().uuid(), done: z.boolean() });
const deleteSchema = z.object({ itemId: z.string().uuid() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('operator');
    const { id } = await params;
    const parsed = addSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);

    // Verificamos pertenencia al tenant antes de escribir el item.
    const task = await loadTaskDetail(auth.tenantId, id);
    if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 });

    await addChecklistItem({ tenantId: auth.tenantId, taskId: id, content: parsed.data.content });
    return NextResponse.json({ task: await loadTaskDetail(auth.tenantId, id) }, { status: 201 });
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
    const parsed = toggleSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);

    await setChecklistItemDone({
      tenantId: auth.tenantId,
      itemId: parsed.data.itemId,
      done: parsed.data.done,
      actorUserId: auth.userId,
    });
    return NextResponse.json({ task: await loadTaskDetail(auth.tenantId, id) });
  } catch (err) {
    return taskErrorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('operator');
    const { id } = await params;
    const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);

    await deleteChecklistItem({ tenantId: auth.tenantId, itemId: parsed.data.itemId });
    return NextResponse.json({ task: await loadTaskDetail(auth.tenantId, id) });
  } catch (err) {
    return taskErrorResponse(err);
  }
}
