import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { waitlistEntries } from '@/lib/db/schema';
import { WaitlistForbiddenError, requireWaitlistRole } from '@/lib/waitlist/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED', 'REMOVED']).optional(),
  notes: z.string().max(1000).nullable().optional(),
  preferredTimeWindowStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  preferredTimeWindowEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { tenantId } = await requireWaitlistRole('operator');
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as unknown;
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const update: Partial<typeof waitlistEntries.$inferInsert> & { updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (parsed.data.status !== undefined) {
      update.status = parsed.data.status;
      if (parsed.data.status === 'REMOVED') update.removedAt = new Date();
    }
    if (parsed.data.notes !== undefined) update.notes = parsed.data.notes;
    if (parsed.data.preferredTimeWindowStart !== undefined) {
      update.preferredTimeWindowStart = parsed.data.preferredTimeWindowStart;
    }
    if (parsed.data.preferredTimeWindowEnd !== undefined) {
      update.preferredTimeWindowEnd = parsed.data.preferredTimeWindowEnd;
    }

    await db
      .update(waitlistEntries)
      .set(update)
      .where(and(eq(waitlistEntries.tenantId, tenantId), eq(waitlistEntries.id, id)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof WaitlistForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error('[api/waitlist/entries/[id]]', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
