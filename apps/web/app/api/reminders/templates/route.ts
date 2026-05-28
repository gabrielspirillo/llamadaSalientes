import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { reminderMessageTemplates, reminderRules } from '@/lib/db/schema';
import { ReminderForbiddenError, requireReminderRole } from '@/lib/reminders/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const buttonSchema = z.object({ id: z.string().max(100), title: z.string().max(40) });
const paramMapSchema = z.union([
  z.object({ source: z.string() }),
  z.object({ literal: z.string() }),
]);

const createSchema = z.object({
  ruleId: z.string().uuid(),
  channel: z.enum(['WHATSAPP', 'VOICE']),
  driverScope: z.enum(['whatsapp_cloud', 'whatsapp_twilio', 'whatsapp_evolution', 'voice_retell']),
  templateName: z.string().max(120).optional().nullable(),
  templateLanguage: z.string().max(10).optional().default('es'),
  templateParamsMap: z.array(paramMapSchema).optional().default([]),
  freeText: z.string().max(4000).optional().nullable(),
  buttons: z.array(buttonSchema).max(3).optional().default([]),
  voicePromptOverride: z.string().max(2000).optional().nullable(),
  enabled: z.boolean().optional().default(true),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  let auth;
  try {
    auth = await requireReminderRole('viewer');
  } catch (err) {
    return errResp(err);
  }
  const ruleId = req.nextUrl.searchParams.get('ruleId');
  const conds = [eq(reminderMessageTemplates.tenantId, auth.tenantId)];
  if (ruleId) conds.push(eq(reminderMessageTemplates.ruleId, ruleId));
  const rows = await db
    .select()
    .from(reminderMessageTemplates)
    .where(and(...conds));
  return NextResponse.json({ templates: rows });
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
  const [rule] = await db
    .select({ id: reminderRules.id })
    .from(reminderRules)
    .where(and(eq(reminderRules.id, parsed.data.ruleId), eq(reminderRules.tenantId, auth.tenantId)))
    .limit(1);
  if (!rule) return NextResponse.json({ error: 'Rule no pertenece al tenant' }, { status: 404 });

  try {
    const [created] = await db
      .insert(reminderMessageTemplates)
      .values({
        tenantId: auth.tenantId,
        ruleId: parsed.data.ruleId,
        channel: parsed.data.channel,
        driverScope: parsed.data.driverScope,
        templateName: parsed.data.templateName ?? null,
        templateLanguage: parsed.data.templateLanguage ?? 'es',
        templateParamsMap: parsed.data.templateParamsMap ?? [],
        freeText: parsed.data.freeText ?? null,
        buttons: parsed.data.buttons ?? [],
        voicePromptOverride: parsed.data.voicePromptOverride ?? null,
        enabled: parsed.data.enabled ?? true,
      })
      .returning();
    return NextResponse.json({ template: created });
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('reminder_message_templates_rule_driver_unique')) {
      return NextResponse.json(
        { error: 'Ya existe un template para esta regla + driverScope. Usá PATCH.' },
        { status: 409 },
      );
    }
    throw err;
  }
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
