import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db/client';
import { taskTemplateItems, taskTemplates } from '@/lib/db/schema';
import { badRequest, taskErrorResponse, templateSchema } from '@/lib/tasks/api';
import { requireTaskRole } from '@/lib/tasks/auth';
import { loadTemplates } from '@/lib/tasks/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('admin');
    const { id } = await params;
    const parsed = templateSchema.partial().safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);
    const d = parsed.data;

    const [existing] = await db
      .select({ id: taskTemplates.id })
      .from(taskTemplates)
      .where(and(eq(taskTemplates.id, id), eq(taskTemplates.tenantId, auth.tenantId)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Rutina no encontrada' }, { status: 404 });

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of [
      'name',
      'description',
      'category',
      'priority',
      'recurrenceFreq',
      'recurrenceInterval',
      'recurrenceWeekdays',
      'recurrenceMonthDay',
      'recurrenceMonth',
      'dueTime',
      'leadDays',
      'defaultRole',
      'defaultAssigneeUserId',
      'requiresEvidence',
      'enabled',
    ] as const) {
      if (d[key] !== undefined) patch[key] = d[key];
    }
    // Cambiar la recurrencia obliga a reevaluar desde cero.
    if (
      d.recurrenceFreq !== undefined ||
      d.recurrenceInterval !== undefined ||
      d.recurrenceWeekdays !== undefined ||
      d.recurrenceMonthDay !== undefined ||
      d.recurrenceMonth !== undefined
    ) {
      patch.lastMaterializedOn = null;
    }

    await db.update(taskTemplates).set(patch).where(eq(taskTemplates.id, id));

    if (d.items !== undefined) {
      await db.delete(taskTemplateItems).where(eq(taskTemplateItems.templateId, id));
      if (d.items.length > 0) {
        await db.insert(taskTemplateItems).values(
          d.items.map((content, i) => ({
            tenantId: auth.tenantId,
            templateId: id,
            content,
            order: i,
          })),
        );
      }
    }

    return NextResponse.json({ templates: await loadTemplates(auth.tenantId) });
  } catch (err) {
    return taskErrorResponse(err);
  }
}

/** Las rutinas del catálogo no se borran: se desactivan. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('admin');
    const { id } = await params;
    const [tpl] = await db
      .select({ isSystem: taskTemplates.isSystem })
      .from(taskTemplates)
      .where(and(eq(taskTemplates.id, id), eq(taskTemplates.tenantId, auth.tenantId)))
      .limit(1);
    if (!tpl) return NextResponse.json({ error: 'Rutina no encontrada' }, { status: 404 });

    if (tpl.isSystem) {
      await db
        .update(taskTemplates)
        .set({ enabled: false, updatedAt: new Date() })
        .where(eq(taskTemplates.id, id));
      return NextResponse.json({ disabled: true });
    }

    await db.delete(taskTemplates).where(eq(taskTemplates.id, id));
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return taskErrorResponse(err);
  }
}
