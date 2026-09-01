import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db/client';
import { taskAutomationRules } from '@/lib/db/schema';
import { automationSchema, badRequest, taskErrorResponse } from '@/lib/tasks/api';
import { requireTaskRole } from '@/lib/tasks/auth';
import { loadAutomationRules } from '@/lib/tasks/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('admin');
    const { id } = await params;
    const parsed = automationSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);

    const [existing] = await db
      .select({ id: taskAutomationRules.id })
      .from(taskAutomationRules)
      .where(and(eq(taskAutomationRules.id, id), eq(taskAutomationRules.tenantId, auth.tenantId)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Regla no encontrada' }, { status: 404 });

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of [
      'enabled',
      'titleTemplate',
      'descriptionTemplate',
      'category',
      'priority',
      'dueOffsetMinutes',
      'assigneeUserId',
      'assigneeRole',
      'requiresEvidence',
      'params',
    ] as const) {
      if (parsed.data[key] !== undefined) patch[key] = parsed.data[key];
    }

    await db.update(taskAutomationRules).set(patch).where(eq(taskAutomationRules.id, id));
    return NextResponse.json({ rules: await loadAutomationRules(auth.tenantId) });
  } catch (err) {
    return taskErrorResponse(err);
  }
}
