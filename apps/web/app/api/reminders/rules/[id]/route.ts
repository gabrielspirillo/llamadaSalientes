import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { reminderRules } from '@/lib/db/schema';
import { ReminderForbiddenError, requireReminderRole } from '@/lib/reminders/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  offsetMinutes: z.number().int().positive().optional(),
  primaryChannel: z.enum(['WHATSAPP', 'VOICE']).optional(),
  fallbackChannel: z.enum(['WHATSAPP', 'VOICE']).optional().nullable(),
  fallbackWindowHours: z.number().int().min(1).max(72).optional().nullable(),
  label: z.string().max(80).optional().nullable(),
  order: z.number().int().min(0).optional(),
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
    .update(reminderRules)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(reminderRules.tenantId, auth.tenantId), eq(reminderRules.id, id)))
    .returning();
  if (!updated) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  return NextResponse.json({ rule: updated });
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
    .delete(reminderRules)
    .where(and(eq(reminderRules.tenantId, auth.tenantId), eq(reminderRules.id, id)))
    .returning({ id: reminderRules.id });
  if (deleted.length === 0) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

function errResp(err: unknown): NextResponse {
  if (err instanceof ReminderForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
