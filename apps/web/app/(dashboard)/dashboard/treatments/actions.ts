'use server';

import { recordAudit } from '@/lib/audit';
import {
  createTreatment,
  deleteTreatment,
  getTreatmentById,
  updateTreatment,
} from '@/lib/data/treatments';
import { getCurrentTenant } from '@/lib/tenant';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const treatmentSchema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres').max(120),
  description: z.string().max(1000).optional().nullable(),
  durationMinutes: z.coerce.number().int().min(5).max(480),
  priceMin: z.string().optional().nullable(),
  priceMax: z.string().optional().nullable(),
  active: z.coerce.boolean().default(true),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createTreatmentAction(formData: FormData): Promise<ActionResult> {
  const { tenant, userId } = await getCurrentTenant();
  const parsed = treatmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  }

  const created = await createTreatment({
    tenantId: tenant.id,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    durationMinutes: parsed.data.durationMinutes,
    priceMin: parsed.data.priceMin ?? null,
    priceMax: parsed.data.priceMax ?? null,
    active: parsed.data.active,
  });

  await recordAudit({
    tenantId: tenant.id,
    actorUserId: null, // Fase 1: aún no mapeamos clerkUserId → users.id
    action: 'create',
    entity: 'treatment',
    entityId: created?.id,
    after: created,
  });

  revalidatePath('/dashboard/treatments');
  return { ok: true };
}

export async function updateTreatmentAction(id: string, formData: FormData): Promise<ActionResult> {
  const { tenant } = await getCurrentTenant();
  const parsed = treatmentSchema.partial().safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  }

  const before = await getTreatmentById(tenant.id, id);
  if (!before) return { ok: false, error: 'Tratamiento no encontrado' };

  const after = await updateTreatment(tenant.id, id, parsed.data);

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
