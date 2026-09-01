import { and, asc, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { treatments } from '@/lib/db/schema';
import { badRequest, taskErrorResponse } from '@/lib/tasks/api';
import { requireTaskRole } from '@/lib/tasks/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  treatmentId: z.string().uuid(),
  postOpFollowUp: z.boolean(),
  postOpFollowUpHours: z.number().int().min(1).max(168).optional(),
});

/**
 * Qué tratamientos generan llamada postoperatoria.
 *
 * Vive dentro de /api/tasks y no en el CRUD de tratamientos porque el flag no
 * cambia nada del tratamiento en sí: solo decide si al completarse una cita
 * nace una tarea. Además el CRUD de tratamientos dispara side effects en GHL
 * (creación de calendario) que acá no queremos.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('viewer');
    const rows = await db
      .select({
        id: treatments.id,
        name: treatments.name,
        postOpFollowUp: treatments.postOpFollowUp,
        postOpFollowUpHours: treatments.postOpFollowUpHours,
      })
      .from(treatments)
      .where(and(eq(treatments.tenantId, auth.tenantId), eq(treatments.active, true)))
      .orderBy(asc(treatments.name));
    return NextResponse.json({ treatments: rows });
  } catch (err) {
    return taskErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('admin');
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);

    const patch: Record<string, unknown> = { postOpFollowUp: parsed.data.postOpFollowUp };
    if (parsed.data.postOpFollowUpHours !== undefined) {
      patch.postOpFollowUpHours = parsed.data.postOpFollowUpHours;
    }

    const updated = await db
      .update(treatments)
      .set(patch)
      .where(
        and(eq(treatments.id, parsed.data.treatmentId), eq(treatments.tenantId, auth.tenantId)),
      )
      .returning({ id: treatments.id });

    if (updated.length === 0) {
      return NextResponse.json({ error: 'Tratamiento no encontrado' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return taskErrorResponse(err);
  }
}
