import { and, asc, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { reminderRuleSets, reminderRules } from '@/lib/db/schema';
import { ReminderForbiddenError, requireReminderRole } from '@/lib/reminders/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  ruleSetId: z.string().uuid(),
  offsetMinutes: z.number().int().positive(),
  primaryChannel: z.enum(['WHATSAPP', 'VOICE']),
  fallbackChannel: z.enum(['WHATSAPP', 'VOICE']).optional().nullable(),
  fallbackWindowHours: z.number().int().min(1).max(72).optional().nullable(),
  label: z.string().max(80).optional().nullable(),
  order: z.number().int().min(0).optional().default(0),
  enabled: z.boolean().optional().default(true),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  let auth;
  try {
    auth = await requireReminderRole('viewer');
  } catch (err) {
    return errResp(err);
  }
  const ruleSetId = req.nextUrl.searchParams.get('ruleSetId');
  const conds = [eq(reminderRules.tenantId, auth.tenantId)];
  if (ruleSetId) conds.push(eq(reminderRules.ruleSetId, ruleSetId));
  const rows = await db
    .select()
    .from(reminderRules)
    .where(and(...conds))
    .orderBy(asc(reminderRules.order));
  return NextResponse.json({ rules: rows });
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
  // Validar ruleSet pertenece al tenant.
  const [rs] = await db
    .select({ id: reminderRuleSets.id })
    .from(reminderRuleSets)
    .where(and(eq(reminderRuleSets.id, parsed.data.ruleSetId), eq(reminderRuleSets.tenantId, auth.tenantId)))
    .limit(1);
  if (!rs) return NextResponse.json({ error: 'Rule set no pertenece al tenant' }, { status: 404 });

  // Si fallback se especifica, asegurar el otro campo presente.
  const { fallbackChannel, fallbackWindowHours } = parsed.data;
  if ((fallbackChannel && !fallbackWindowHours) || (!fallbackChannel && fallbackWindowHours)) {
    return NextResponse.json(
      { error: 'fallbackChannel y fallbackWindowHours deben ir juntos' },
      { status: 400 },
    );
  }
  if (fallbackChannel && fallbackChannel === parsed.data.primaryChannel) {
    return NextResponse.json(
      { error: 'fallbackChannel no puede ser igual al primaryChannel' },
      { status: 400 },
    );
  }

  const [created] = await db
    .insert(reminderRules)
    .values({
      tenantId: auth.tenantId,
      ruleSetId: parsed.data.ruleSetId,
      offsetMinutes: parsed.data.offsetMinutes,
      primaryChannel: parsed.data.primaryChannel,
      fallbackChannel: fallbackChannel ?? null,
      fallbackWindowHours: fallbackWindowHours ?? null,
      label: parsed.data.label ?? null,
      order: parsed.data.order ?? 0,
      enabled: parsed.data.enabled ?? true,
    })
    .returning();

  return NextResponse.json({ rule: created });
}

function errResp(err: unknown): NextResponse {
  if (err instanceof ReminderForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
