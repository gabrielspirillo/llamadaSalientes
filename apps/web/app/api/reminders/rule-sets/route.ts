import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { reminderRuleSets } from '@/lib/db/schema';
import { ReminderForbiddenError, requireReminderRole } from '@/lib/reminders/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  scope: z.enum(['GLOBAL', 'TREATMENT']),
  treatmentId: z.string().uuid().optional(),
  enabled: z.boolean().optional().default(true),
  quietMode: z.enum(['SHIFT_INTO_HOURS', 'SKIP']).optional().default('SHIFT_INTO_HOURS'),
});

export async function GET(): Promise<NextResponse> {
  let auth;
  try {
    auth = await requireReminderRole('viewer');
  } catch (err) {
    return errResp(err);
  }
  const rows = await db
    .select()
    .from(reminderRuleSets)
    .where(eq(reminderRuleSets.tenantId, auth.tenantId));
  return NextResponse.json({ ruleSets: rows });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let auth;
  try {
    auth = await requireReminderRole('admin');
  } catch (err) {
    return errResp(err);
  }
  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', issues: parsed.error.issues }, { status: 400 });
  }
  const { scope, treatmentId, enabled, quietMode } = parsed.data;
  if (scope === 'TREATMENT' && !treatmentId) {
    return NextResponse.json({ error: 'treatmentId requerido para scope TREATMENT' }, { status: 400 });
  }

  // Si scope=GLOBAL, asegurar que no exista otro GLOBAL para el tenant.
  if (scope === 'GLOBAL') {
    const [existing] = await db
      .select({ id: reminderRuleSets.id })
      .from(reminderRuleSets)
      .where(
        and(eq(reminderRuleSets.tenantId, auth.tenantId), eq(reminderRuleSets.scope, 'GLOBAL')),
      )
      .limit(1);
    if (existing) {
      return NextResponse.json({ error: 'Ya existe un rule set global', existingId: existing.id }, { status: 409 });
    }
  }

  const [created] = await db
    .insert(reminderRuleSets)
    .values({
      tenantId: auth.tenantId,
      scope,
      treatmentId: treatmentId ?? null,
      enabled,
      quietMode,
      updatedBy: auth.userId,
    })
    .returning();

  return NextResponse.json({ ruleSet: created });
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
