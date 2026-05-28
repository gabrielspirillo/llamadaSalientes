import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { waitlistSettings } from '@/lib/db/schema';
import {
  WaitlistForbiddenError,
  requireWaitlistRole,
} from '@/lib/waitlist/auth';
import { getOrCreateWaitlistSettings } from '@/lib/waitlist/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  channelMode: z.enum(['WHATSAPP_ONLY', 'VOICE_ONLY', 'WHATSAPP_THEN_VOICE']).optional(),
  ttlMinutesDefault: z.number().int().min(15).max(7 * 24 * 60).optional(),
  ttlMinutesNearSlot: z.number().int().min(5).max(24 * 60).optional(),
  nearSlotHoursThreshold: z.number().int().min(1).max(72).optional(),
  minSkipHoursThreshold: z.number().int().min(0).max(72).optional(),
  whatsappToVoiceWindowMinutes: z.number().int().min(5).max(24 * 60).optional(),
  minAppointmentDistanceDays: z.number().int().min(0).max(365).optional(),
  maxAppointmentDistanceDays: z.number().int().min(1).max(365).nullable().optional(),
  minAdvanceDays: z.number().int().min(0).max(180).optional(),
  requireSameDentist: z.boolean().optional(),
  respectTimeWindow: z.boolean().optional(),
});

export async function GET(): Promise<NextResponse> {
  try {
    const { tenantId } = await requireWaitlistRole('viewer');
    const row = await getOrCreateWaitlistSettings(tenantId);
    return NextResponse.json({ ok: true, settings: row });
  } catch (err) {
    return errResp(err);
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const { tenantId, userId } = await requireWaitlistRole('admin');
    const body = (await req.json().catch(() => null)) as unknown;
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    await getOrCreateWaitlistSettings(tenantId); // garantiza fila
    await db
      .update(waitlistSettings)
      .set({ ...parsed.data, updatedBy: userId, updatedAt: new Date() })
      .where(eq(waitlistSettings.tenantId, tenantId));
    const [row] = await db
      .select()
      .from(waitlistSettings)
      .where(eq(waitlistSettings.tenantId, tenantId))
      .limit(1);
    return NextResponse.json({ ok: true, settings: row });
  } catch (err) {
    return errResp(err);
  }
}

function errResp(err: unknown): NextResponse {
  if (err instanceof WaitlistForbiddenError) {
    return NextResponse.json(
      { error: err.message, actual: err.actual, required: err.required },
      { status: 403 },
    );
  }
  console.error('[api/waitlist/settings]', err);
  return NextResponse.json({ error: 'Error interno' }, { status: 500 });
}
