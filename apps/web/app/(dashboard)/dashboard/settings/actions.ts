'use server';

import { recordAudit } from '@/lib/audit';
import { getClinicSettings, updateClinicSettings } from '@/lib/data/clinic';
import { requireTaskRole } from '@/lib/tasks/auth';
import { getCurrentTenant } from '@/lib/tenant';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const dayHoursSchema = z
  .object({
    open: z.string().regex(timeRegex, 'Hora inválida (HH:MM)'),
    close: z.string().regex(timeRegex, 'Hora inválida (HH:MM)'),
  })
  .refine((d) => d === null || d.open < d.close, 'La apertura tiene que ser antes del cierre')
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
  // Un teléfono de la clínica: cifras, espacios, +, guiones y paréntesis.
  phones: z
    .array(
      z
        .string()
        .max(40)
        .regex(/^[+\d\s().-]{6,40}$/, 'Teléfono no válido'),
    )
    .optional(),
  // Una zona inválida rompe todas las horas del panel y de los agentes.
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat('es-ES', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Zona horaria no válida'),
  defaultLanguage: z.enum(['es', 'en']),
  afterHoursMessage: z.string().max(1000).optional().nullable(),
  recordingConsentText: z.string().min(20, 'El mensaje de consentimiento es obligatorio'),
  transferNumber: z
    .string()
    .regex(
      e164Regex,
      'El número al que se pasa la llamada debe ir en formato E.164 (p. ej. +34600123456)',
    )
    .or(z.literal(''))
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  workingHours: workingHoursSchema,
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function updateClinicSettingsAction(input: unknown): Promise<ActionResult> {
  // El rol se comprueba aquí, no sólo escondiendo el botón: antes cualquiera
  // con sesión en la clínica podía cambiar su horario o su número de desvío.
  // Mismo listón que tocar estos datos desde el entrenador (operator).
  try {
    await requireTaskRole('operator');
  } catch {
    return { ok: false, error: 'No tienes permiso para cambiar los datos de la clínica.' };
  }
  const { tenant } = await getCurrentTenant();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  }

  const before = await getClinicSettings(tenant.id);
  const after = await updateClinicSettings(tenant.id, parsed.data);
  if (!after) {
    return {
      ok: false,
      error: 'No se pudieron guardar los datos de la clínica. Recarga e inténtalo de nuevo.',
    };
  }

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
