'use server';

import { recordAudit } from '@/lib/audit';
import { createFaq, deleteFaq, getFaqById, updateFaq } from '@/lib/data/faqs';
import { getCurrentTenant } from '@/lib/tenant';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const faqSchema = z.object({
  category: z.string().max(60).optional().nullable(),
  question: z.string().min(5, 'Mínimo 5 caracteres').max(300),
  answer: z.string().min(5, 'Mínimo 5 caracteres').max(2000),
  priority: z.coerce.number().int().min(0).max(100).default(0),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createFaqAction(formData: FormData): Promise<ActionResult> {
  const { tenant } = await getCurrentTenant();
  const parsed = faqSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  }

  const created = await createFaq({
    tenantId: tenant.id,
    category: parsed.data.category ?? null,
    question: parsed.data.question,
    answer: parsed.data.answer,
    priority: parsed.data.priority,
  });

  await recordAudit({
    tenantId: tenant.id,
    action: 'create',
    entity: 'faq',
    entityId: created?.id,
    after: created,
  });

  revalidatePath('/dashboard/faqs');
  return { ok: true };
}

export async function updateFaqAction(id: string, formData: FormData): Promise<ActionResult> {
  const { tenant } = await getCurrentTenant();
  const parsed = faqSchema.partial().safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  }

  const before = await getFaqById(tenant.id, id);
  if (!before) return { ok: false, error: 'FAQ no encontrada' };

  const after = await updateFaq(tenant.id, id, parsed.data);

  await recordAudit({
    tenantId: tenant.id,
    action: 'update',
    entity: 'faq',
    entityId: id,
    before,
    after,
  });

  revalidatePath('/dashboard/faqs');
  return { ok: true };
}

export async function deleteFaqAction(id: string): Promise<ActionResult> {
  const { tenant } = await getCurrentTenant();
  const before = await getFaqById(tenant.id, id);
  if (!before) return { ok: false, error: 'FAQ no encontrada' };

  await deleteFaq(tenant.id, id);

  await recordAudit({
    tenantId: tenant.id,
    action: 'delete',
    entity: 'faq',
    entityId: id,
    before,
  });

  revalidatePath('/dashboard/faqs');
  return { ok: true };
}
