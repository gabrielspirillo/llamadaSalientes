'use server';

import { recordAudit } from '@/lib/audit';
import {
  createTreatment,
  deleteTreatment,
  getTreatmentById,
  updateTreatment,
} from '@/lib/data/treatments';
import { createCalendarForTreatment } from '@/lib/ghl/calendars';
import { getCurrentTenant } from '@/lib/tenant';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

// "true"|"false" string del form → boolean
const checkboxString = z
  .union([z.literal('on'), z.literal('true'), z.literal('false'), z.literal('')])
  .optional()
  .transform((v) => v === 'on' || v === 'true');

// CSV de "Mon,Tue,Wed,..." → array
const daysCsv = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').filter(Boolean) : []));

const treatmentSchema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres').max(120),
  description: z.string().max(1000).optional().nullable(),
  durationMinutes: z.coerce.number().int().min(5).max(480),
  priceMin: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  priceMax: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  active: checkboxString,
  // Schedule (opcional). Si vienen, creamos calendario en GHL al crear el treatment.
  scheduleDays: daysCsv,
  scheduleStart: z.string().optional(), // "09:00"
  scheduleEnd: z.string().optional(), // "18:00"
});

export type ActionResult = { ok: true } | { ok: false; error: string };

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : 'Error desconocido';
}

export async function createTreatmentAction(formData: FormData): Promise<ActionResult> {
  try {
    const { tenant } = await getCurrentTenant();
    const parsed = treatmentSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return { ok: false, error: `${first?.path.join('.') || 'campo'}: ${first?.message ?? 'inválido'}` };
    }

    let ghlCalendarId: string | null = null;
    if (parsed.data.scheduleDays.length > 0 && parsed.data.scheduleStart && parsed.data.scheduleEnd) {
      try {
        ghlCalendarId = await createCalendarForTreatment(tenant.id, {
          name: parsed.data.name,
          durationMinutes: parsed.data.durationMinutes,
          days: parsed.data.scheduleDays as Array<'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'>,
          startTime: parsed.data.scheduleStart,
          endTime: parsed.data.scheduleEnd,
        });
      } catch (err) {
        console.error('[createTreatmentAction] crearCalendar GHL fallo:', err);
        // No bloqueamos: el treatment se crea igual, el usuario puede asociar
        // el calendario después manualmente.
      }
    }

    const created = await createTreatment({
      tenantId: tenant.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      durationMinutes: parsed.data.durationMinutes,
      priceMin: parsed.data.priceMin,
      priceMax: parsed.data.priceMax,
      active: parsed.data.active,
      ghlCalendarId,
    });

    await recordAudit({
      tenantId: tenant.id,
      actorUserId: null,
      action: 'create',
      entity: 'treatment',
      entityId: created?.id,
      after: created,
    });

    revalidatePath('/dashboard/treatments');
    return { ok: true };
  } catch (err) {
    console.error('[createTreatmentAction]', err);
    return { ok: false, error: errorMessage(err) };
  }
}

export async function updateTreatmentAction(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const { tenant } = await getCurrentTenant();
    const parsed = treatmentSchema.partial().safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return { ok: false, error: `${first?.path.join('.') || 'campo'}: ${first?.message ?? 'inválido'}` };
    }

    const before = await getTreatmentById(tenant.id, id);
    if (!before) return { ok: false, error: 'Tratamiento no encontrado' };

    // Sólo pasamos campos que vinieron
    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description ?? null;
    if (parsed.data.durationMinutes !== undefined) patch.durationMinutes = parsed.data.durationMinutes;
    if (parsed.data.priceMin !== undefined) patch.priceMin = parsed.data.priceMin;
    if (parsed.data.priceMax !== undefined) patch.priceMax = parsed.data.priceMax;
    if (parsed.data.active !== undefined) patch.active = parsed.data.active;

    const after = await updateTreatment(tenant.id, id, patch);

    await recordAudit({
      tenantId: tenant.id,
      action: 'update',
      entity: 'treatment',
      entityId: id,
      before,
      after,
    });

    revalidatePath('/dashboard/treatments');
    return { ok: true };
  } catch (err) {
    console.error('[updateTreatmentAction]', err);
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteTreatmentAction(id: string): Promise<ActionResult> {
  const { tenant } = await getCurrentTenant();
  const before = await getTreatmentById(tenant.id, id);
  if (!before) return { ok: false, error: 'Tratamiento no encontrado' };

  await deleteTreatment(tenant.id, id);

  await recordAudit({
    tenantId: tenant.id,
    action: 'delete',
    entity: 'treatment',
    entityId: id,
    before,
  });

  revalidatePath('/dashboard/treatments');
  return { ok: true };
}
