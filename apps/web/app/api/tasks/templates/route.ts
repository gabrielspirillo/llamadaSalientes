import { type NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db/client';
import { taskTemplateItems, taskTemplates } from '@/lib/db/schema';
import { badRequest, taskErrorResponse, templateSchema } from '@/lib/tasks/api';
import { requireTaskRole } from '@/lib/tasks/auth';
import { loadTemplates } from '@/lib/tasks/queries';
import { seedSystemTemplates } from '@/lib/tasks/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('viewer');
    return NextResponse.json({ templates: await loadTemplates(auth.tenantId) });
  } catch (err) {
    return taskErrorResponse(err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('admin');
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

    // Acción especial: reinstalar el catálogo de rutinas de clínica dental.
    if (body?.action === 'seed') {
      const added = await seedSystemTemplates(auth.tenantId);
      return NextResponse.json({ added, templates: await loadTemplates(auth.tenantId) });
    }

    const parsed = templateSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.issues);
    const d = parsed.data;

    const [created] = await db
      .insert(taskTemplates)
      .values({
        tenantId: auth.tenantId,
        name: d.name,
        description: d.description ?? null,
        category: d.category ?? 'ADMIN',
        priority: d.priority ?? 'MEDIUM',
        recurrenceFreq: d.recurrenceFreq ?? 'WEEKLY',
        recurrenceInterval: d.recurrenceInterval ?? 1,
        recurrenceWeekdays: d.recurrenceWeekdays ?? [],
        recurrenceMonthDay: d.recurrenceMonthDay ?? null,
        recurrenceMonth: d.recurrenceMonth ?? null,
        dueTime: d.dueTime ?? '09:00',
        leadDays: d.leadDays ?? 0,
        defaultRole: d.defaultRole ?? null,
        defaultAssigneeUserId: d.defaultAssigneeUserId ?? null,
        requiresEvidence: d.requiresEvidence ?? false,
        enabled: d.enabled ?? true,
        isSystem: false,
      })
      .returning({ id: taskTemplates.id });
    if (!created) {
      return NextResponse.json({ error: 'No se pudo crear la rutina' }, { status: 500 });
    }

    if (d.items && d.items.length > 0) {
      await db.insert(taskTemplateItems).values(
        d.items.map((content, i) => ({
          tenantId: auth.tenantId,
          templateId: created.id,
          content,
          order: i,
        })),
      );
    }

    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (err) {
    return taskErrorResponse(err);
  }
}
