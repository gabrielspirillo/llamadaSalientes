import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { waitlistMessageTemplates } from '@/lib/db/schema';
import { WaitlistForbiddenError, requireWaitlistRole } from '@/lib/waitlist/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const buttonSchema = z.object({ id: z.string(), title: z.string() });
const paramSchema = z.union([z.object({ source: z.string() }), z.object({ literal: z.string() })]);

const upsertSchema = z.object({
  channel: z.enum(['WHATSAPP', 'VOICE']),
  driverScope: z.enum(['whatsapp_cloud', 'whatsapp_twilio', 'whatsapp_evolution', 'voice_retell']),
  templateName: z.string().nullable().optional(),
  templateLanguage: z.string().default('es'),
  templateParamsMap: z.array(paramSchema).default([]),
  freeText: z.string().nullable().optional(),
  buttons: z.array(buttonSchema).default([]),
  voicePromptOverride: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
});

export async function GET(): Promise<NextResponse> {
  try {
    const { tenantId } = await requireWaitlistRole('viewer');
    const rows = await db
      .select()
      .from(waitlistMessageTemplates)
      .where(eq(waitlistMessageTemplates.tenantId, tenantId));
    return NextResponse.json({ ok: true, templates: rows });
  } catch (err) {
    return errResp(err);
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const { tenantId } = await requireWaitlistRole('admin');
    const body = (await req.json().catch(() => null)) as unknown;
    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const v = parsed.data;
    const [existing] = await db
      .select({ id: waitlistMessageTemplates.id })
      .from(waitlistMessageTemplates)
      .where(
        and(
          eq(waitlistMessageTemplates.tenantId, tenantId),
          eq(waitlistMessageTemplates.driverScope, v.driverScope),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(waitlistMessageTemplates)
        .set({
          channel: v.channel,
          templateName: v.templateName ?? null,
          templateLanguage: v.templateLanguage,
          templateParamsMap: v.templateParamsMap,
          freeText: v.freeText ?? null,
          buttons: v.buttons,
          voicePromptOverride: v.voicePromptOverride ?? null,
          enabled: v.enabled,
          updatedAt: new Date(),
        })
        .where(eq(waitlistMessageTemplates.id, existing.id));
      return NextResponse.json({ ok: true, id: existing.id });
    }

    const [inserted] = await db
      .insert(waitlistMessageTemplates)
      .values({
        tenantId,
        channel: v.channel,
        driverScope: v.driverScope,
        templateName: v.templateName ?? null,
        templateLanguage: v.templateLanguage,
        templateParamsMap: v.templateParamsMap,
        freeText: v.freeText ?? null,
        buttons: v.buttons,
        voicePromptOverride: v.voicePromptOverride ?? null,
        enabled: v.enabled,
      })
      .returning({ id: waitlistMessageTemplates.id });
    return NextResponse.json({ ok: true, id: inserted!.id });
  } catch (err) {
    return errResp(err);
  }
}

function errResp(err: unknown): NextResponse {
  if (err instanceof WaitlistForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  console.error('[api/waitlist/templates]', err);
  return NextResponse.json({ error: 'Error interno' }, { status: 500 });
}
