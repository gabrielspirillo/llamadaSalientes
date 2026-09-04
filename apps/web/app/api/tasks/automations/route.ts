import { type NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db/client';
import { taskAutomationRules } from '@/lib/db/schema';
import { automationCreateSchema, badRequest, taskErrorResponse } from '@/lib/tasks/api';
import { requireTaskRole } from '@/lib/tasks/auth';
import { ensureAutomationRules } from '@/lib/tasks/automation';
import { loadAutomationRules } from '@/lib/tasks/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('viewer');
    await ensureAutomationRules(auth.tenantId);
    return NextResponse.json({ rules: await loadAutomationRules(auth.tenantId) });
  } catch (err) {
    return taskErrorResponse(err);
  }
}

/** Alta de una automatización a medida sobre un evento del producto. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('admin');
    const parsed = automationCreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);
    const d = parsed.data;

    const [created] = await db
      .insert(taskAutomationRules)
      .values({
        tenantId: auth.tenantId,
        trigger: d.trigger,
        name: d.name,
        isSystem: false,
        enabled: true,
        titleTemplate: d.titleTemplate,
        descriptionTemplate: d.descriptionTemplate ?? null,
        category: d.category ?? 'PATIENT',
        priority: d.priority ?? 'HIGH',
        dueOffsetMinutes: d.dueOffsetMinutes ?? 120,
        assigneeUserId: d.assigneeUserId ?? null,
        requiresEvidence: d.requiresEvidence ?? false,
        conditions: d.conditions ?? [],
        checklist: d.checklist ?? [],
        params: {},
      })
      .returning({ id: taskAutomationRules.id });

    if (!created) {
      return NextResponse.json({ error: 'No se pudo crear la automatización' }, { status: 500 });
    }

    return NextResponse.json(
      { id: created.id, rules: await loadAutomationRules(auth.tenantId) },
      { status: 201 },
    );
  } catch (err) {
    return taskErrorResponse(err);
  }
}
