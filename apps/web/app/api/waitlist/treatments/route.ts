import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { treatments } from '@/lib/db/schema';
import { WaitlistForbiddenError, requireWaitlistRole } from '@/lib/waitlist/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  treatmentId: z.string().uuid(),
  waitlistEligible: z.boolean(),
});

// PATCH /api/waitlist/treatments — alterna el toggle waitlist_eligible.
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const { tenantId } = await requireWaitlistRole('admin');
    const body = (await req.json().catch(() => null)) as unknown;
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    }
    await db
      .update(treatments)
      .set({ waitlistEligible: parsed.data.waitlistEligible })
      .where(eq(treatments.id, parsed.data.treatmentId));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof WaitlistForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error('[api/waitlist/treatments]', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
