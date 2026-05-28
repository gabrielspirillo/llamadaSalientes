import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { reminderRuleSets } from '@/lib/db/schema';
import { ReminderForbiddenError, requireReminderRole } from '@/lib/reminders/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  quietMode: z.enum(['SHIFT_INTO_HOURS', 'SKIP']).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let auth;
  try {
    auth = await requireReminderRole('admin');
  } catch (err) {
    return errResp(err);
  }
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
  }
  const [updated] = await db
    .update(reminderRuleSets)
    .set({ ...parsed.data, updatedBy: auth.userId, updatedAt: new Date() })
    .where(and(eq(reminderRuleSets.tenantId, auth.tenantId), eq(reminderRuleSets.id, id)))
    .returning();
  if (!updated) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  return NextResponse.json({ ruleSet: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let auth;
  try {
    auth = await requireReminderRole('admin');
  } catch (err) {
    return errResp(err);
  }
  const { id } = await params;
  const deleted = await db
    .delete(reminderRuleSets)
    .where(and(eq(reminderRuleSets.tenantId, auth.tenantId), eq(reminderRuleSets.id, id)))
    .returning({ id: reminderRuleSets.id });
  if (deleted.length === 0) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

function errResp(err: unknown): NextResponse {
  if (err instanceof ReminderForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  console.error('[reminders-api] auth error', err);
  return NextResponse.json(
    { error: (err as Error)?.message ?? 'Unauthorized' },
    { status: 401 },
  );
}
