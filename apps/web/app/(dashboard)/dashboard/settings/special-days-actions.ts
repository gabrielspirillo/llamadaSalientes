'use server';

import { AgendaForbiddenError, getAgendaContext } from '@/lib/agenda/auth';
import { describeRanges } from '@/lib/agenda/special-days';
import { SpecialDayError, deleteSpecialDay, upsertSpecialDay } from '@/lib/agenda/special-days-db';
import { recordAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const inputSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige la fecha.'),
  professionalIds: z.array(z.string().uuid()).min(1, 'Elige quién trabaja ese día.').max(20),
  ranges: z
    .array(z.object({ start: z.number().int(), end: z.number().int() }))
    .min(1, 'Indica al menos una franja.')
    .max(3),
  note: z.string().max(200).optional().nullable(),
});

export type SpecialDayActionResult =
  | { ok: true; outside: number; summary: string }
  | { ok: false; error: string };

/**
 * Guarda el horario especial de un día para los profesionales elegidos. Sólo
 * admin de la clínica o Futura (los mismos que tocan el horario semanal).
 */
export async function saveSpecialDayAction(input: unknown): Promise<SpecialDayActionResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' };
  }
  try {
    const ctx = await getAgendaContext();
    if (!ctx.canManageProfessionals) {
      throw new AgendaForbiddenError(
        'Sólo un administrador de la clínica puede cambiar el horario.',
      );
    }
    let outside = 0;
    for (const professionalId of parsed.data.professionalIds) {
      const res = await upsertSpecialDay(ctx, {
        professionalId,
        day: parsed.data.day,
        ranges: parsed.data.ranges,
        note: parsed.data.note ?? null,
      });
      outside += res.outside;
      await recordAudit({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'update',
        entity: 'professional_schedule',
        entityId: professionalId,
        after: { specialDay: parsed.data.day, ranges: parsed.data.ranges },
      });
    }
    revalidatePath('/dashboard/settings');
    revalidatePath('/dashboard/agenda');
    return { ok: true, outside, summary: describeRanges(parsed.data.ranges) };
  } catch (err) {
    if (err instanceof SpecialDayError || err instanceof AgendaForbiddenError) {
      return { ok: false, error: err.message };
    }
    console.error('[dias-especiales] guardar', err);
    return { ok: false, error: 'No se pudo guardar. Inténtalo de nuevo.' };
  }
}

/** Quita el horario especial: ese día vuelve el horario de siempre. */
export async function deleteSpecialDayAction(ids: string[]): Promise<SpecialDayActionResult> {
  const parsed = z.array(z.string().uuid()).min(1).max(20).safeParse(ids);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos.' };
  try {
    const ctx = await getAgendaContext();
    if (!ctx.canManageProfessionals) {
      throw new AgendaForbiddenError(
        'Sólo un administrador de la clínica puede cambiar el horario.',
      );
    }
    for (const id of parsed.data) {
      await deleteSpecialDay(ctx, id);
      await recordAudit({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'delete',
        entity: 'professional_schedule',
        entityId: id,
        after: { specialDayRemoved: id },
      });
    }
    revalidatePath('/dashboard/settings');
    revalidatePath('/dashboard/agenda');
    return { ok: true, outside: 0, summary: '' };
  } catch (err) {
    if (err instanceof SpecialDayError || err instanceof AgendaForbiddenError) {
      return { ok: false, error: err.message };
    }
    console.error('[dias-especiales] quitar', err);
    return { ok: false, error: 'No se pudo quitar. Inténtalo de nuevo.' };
  }
}
