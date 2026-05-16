'use server';

import { recordAudit } from '@/lib/audit';
import { getClinicSettings, updateClinicSettings } from '@/lib/data/clinic';
import { getCurrentTenant } from '@/lib/tenant';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const dayHoursSchema = z
  .object({
    open: z.string().regex(timeRegex, 'Hora inválida (HH:MM)'),
    close: z.string().regex(timeRegex, 'Hora inválida (HH:MM)'),
  })
  .nullable();

const workingHoursSchema = z.object({
  monday: dayHoursSchema,
  tuesday: dayHoursSchema,
  wednesday: dayHoursSchema,
  thursday: dayHoursSchema,
  friday: dayHoursSchema,
  saturday: dayHoursSchema,
  sunday: dayHoursSchema,
});

const e164Regex = /^\+[1-9]\d{6,14}$/;

const settingsSchema = z.object({
  address: z.string().max(300).optional().nullable(),
  phones: z.array(z.string().max(40)).optional(),
  timezone: z.string().min(2),
  defaultLanguage: z.enum(['es', 'en']),
  afterHoursMessage: z.string().max(1000).optional().nullable(),
  recordingConsentText: z.string().min(20, 'El mensaje de consentimiento es obligatorio'),
  transferNumber: z
    .string()
    .regex(e164Regex, 'El número de transferencia debe estar en formato E.164 (ej. +5491139530968)')
    .or(z.literal(''))
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  workingHours: workingHoursSchema,
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function updateClinicSettingsAction(input: unknown): Promise<ActionResult> {
  const { tenant } = await getCurrentTenant();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  }

  const before = await getClinicSettings(tenant.id);
  const after = await updateClinicSettings(tenant.id, parsed.data);

  await recordAudit({
    tenantId: tenant.id,
    action: 'update',
    entity: 'clinic_settings',
    entityId: tenant.id,
    before,
    after,
  });

  revalidatePath('/dashboard/settings');
  return { ok: true };
}
