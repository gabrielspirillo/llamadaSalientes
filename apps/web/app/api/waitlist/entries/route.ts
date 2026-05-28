import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { waitlistEntries } from '@/lib/db/schema';
import { WaitlistForbiddenError, requireWaitlistRole } from '@/lib/waitlist/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  ghlContactId: z.string().min(1),
  ghlAppointmentId: z.string().min(1),
  treatmentId: z.string().uuid().nullable().optional(),
  calendarId: z.string().nullable().optional(),
  assignedDentistId: z.string().nullable().optional(),
  originalStartTime: z.string().datetime(),
  originalEndTime: z.string().datetime().nullable().optional(),
  preferredTimeWindowStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  preferredTimeWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

// POST /api/waitlist/entries — alta manual desde el dashboard.
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { tenantId } = await requireWaitlistRole('operator');
    const body = (await req.json().catch(() => null)) as unknown;
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const [row] = await db
      .insert(waitlistEntries)
      .values({
        tenantId,
        ghlContactId: parsed.data.ghlContactId,
        ghlAppointmentId: parsed.data.ghlAppointmentId,
        treatmentId: parsed.data.treatmentId ?? null,
        calendarId: parsed.data.calendarId ?? null,
        assignedDentistId: parsed.data.assignedDentistId ?? null,
        originalStartTime: new Date(parsed.data.originalStartTime),
        originalEndTime: parsed.data.originalEndTime
          ? new Date(parsed.data.originalEndTime)
          : null,
        preferredTimeWindowStart: parsed.data.preferredTimeWindowStart ?? null,
        preferredTimeWindowEnd: parsed.data.preferredTimeWindowEnd ?? null,
        notes: parsed.data.notes ?? null,
        source: 'manual',
        status: 'ACTIVE',
      })
      .onConflictDoNothing({
        target: [waitlistEntries.tenantId, waitlistEntries.ghlAppointmentId],
      })
      .returning({ id: waitlistEntries.id });
    if (!row) {
      return NextResponse.json(
        { error: 'Ya existe una entrada para esa cita' },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, entryId: row.id });
  } catch (err) {
    if (err instanceof WaitlistForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error('[api/waitlist/entries POST]', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
