import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { reminderMessageTemplates } from '@/lib/db/schema';
import { ReminderForbiddenError, requireReminderRole } from '@/lib/reminders/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const buttonSchema = z.object({ id: z.string().max(100), title: z.string().max(40) });
const paramMapSchema = z.union([
  z.object({ source: z.string() }),
  z.object({ literal: z.string() }),
]);

const patchSchema = z.object({
  templateName: z.string().max(120).optional().nullable(),
  templateLanguage: z.string().max(10).optional(),
  templateParamsMap: z.array(paramMapSchema).optional(),
  freeText: z.string().max(4000).optional().nullable(),
  buttons: z.array(buttonSchema).max(3).optional(),
  voicePromptOverride: z.string().max(2000).optional().nullable(),
  enabled: z.boolean().optional(),
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
    .update(reminderMessageTemplates)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(reminderMessageTemplates.tenantId, auth.tenantId), eq(reminderMessageTemplates.id, id)))
    .returning();
  if (!updated) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  return NextResponse.json({ template: updated });
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
    .delete(reminderMessageTemplates)
    .where(and(eq(reminderMessageTemplates.tenantId, auth.tenantId), eq(reminderMessageTemplates.id, id)))
    .returning({ id: reminderMessageTemplates.id });
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
