import 'server-only';

import { recordAudit } from '@/lib/audit';
import { getClinicSettings, updateClinicSettings } from '@/lib/data/clinic';
import { createFaq, deleteFaq, getFaqById, listFaqsForTenant, updateFaq } from '@/lib/data/faqs';
import {
  createTreatment,
  getTreatmentById,
  listTreatmentsForTenant,
  updateTreatment,
} from '@/lib/data/treatments';

import type { ClinicDataContext, DataChangeProposal } from './data-changes';

/**
 * Los datos de la clínica, tal como los ve y los toca el entrenamiento.
 *
 * No hay copia de nada: se lee y se escribe sobre `treatments`, `faqs` y
 * `clinic_settings`, las mismas tablas que editan Registros → Tratamientos,
 * Registros → Preguntas frecuentes y Clínica → Datos de la clínica. Un cambio
 * aplicado desde la charla sale en esas pantallas en el acto, y al revés.
 */
export async function loadClinicDataContext(tenantId: string): Promise<ClinicDataContext> {
  const [treatmentRows, faqRows, settings] = await Promise.all([
    listTreatmentsForTenant(tenantId),
    listFaqsForTenant(tenantId),
    getClinicSettings(tenantId),
  ]);

  return {
    treatments: treatmentRows.slice(0, 60).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      durationMinutes: t.durationMinutes,
      priceMin: t.priceMin != null ? Number(t.priceMin) : null,
      priceMax: t.priceMax != null ? Number(t.priceMax) : null,
      currency: t.currency,
      active: t.active !== false,
    })),
    faqs: faqRows.slice(0, 40).map((f) => ({
      id: f.id,
      category: f.category,
      question: f.question,
      answer: f.answer,
    })),
    clinic: {
      address: settings?.address ?? null,
      phones: settings?.phones ?? [],
      transferNumber: settings?.transferNumber ?? null,
    },
  };
}

/** Lo que el entrenador ve del catálogo. Con id: sin él no puede editar nada. */
export function formatDataContextForPrompt(ctx: ClinicDataContext): string {
  const tratamientos = ctx.treatments.length
    ? ctx.treatments
        .map((t) => {
          const precio =
            t.priceMin == null && t.priceMax == null
              ? 'sin precio'
              : t.priceMin != null && t.priceMax != null && t.priceMin !== t.priceMax
                ? `${t.priceMin}-${t.priceMax} ${t.currency ?? 'EUR'}`
                : `${t.priceMin ?? t.priceMax} ${t.currency ?? 'EUR'}`;
          return `- [${t.id}] ${t.name} · ${t.durationMinutes} min · ${precio}${
            t.active ? '' : ' · NO se ofrece ahora'
          }`;
        })
        .join('\n')
    : '(catálogo vacío: no hay ningún tratamiento cargado)';

  const preguntas = ctx.faqs.length
    ? ctx.faqs.map((f) => `- [${f.id}] ${f.question} → ${f.answer}`).join('\n')
    : '(no hay preguntas frecuentes cargadas)';

  return `Tratamientos del catálogo (el id entre corchetes es el que va en target_id):
${tratamientos}

Preguntas frecuentes cargadas:
${preguntas}

Datos de la clínica:
- Dirección: ${ctx.clinic.address ?? '(vacía)'}
- Teléfonos: ${ctx.clinic.phones.join(', ') || '(vacíos)'}
- Número de recepción: ${ctx.clinic.transferNumber ?? '(vacío)'}`;
}

export type ApplyResult = { ok: true; summary: string } | { ok: false; error: string };

/**
 * Aplica un cambio ya aprobado por una persona.
 *
 * Vuelve a comprobar TODO contra la base —que la fila exista y sea de esta
 * clínica— en vez de fiarse de lo que trae la tarjeta: entre que el entrenador
 * la propuso y alguien la pulsó pueden haber pasado días, y el cuerpo de una
 * Server Action lo escribe el navegador.
 */
export async function applyDataChange(input: {
  tenantId: string;
  userId: string | null;
  change: DataChangeProposal;
}): Promise<ApplyResult> {
  const { tenantId, userId, change } = input;
  const f = change.fields as Record<string, unknown>;

  if (change.entity === 'TREATMENT') {
    if (change.op === 'CREATE') {
      const name = typeof f.name === 'string' ? f.name : null;
      const duration = typeof f.durationMinutes === 'number' ? f.durationMinutes : null;
      if (!name || !duration) return { ok: false, error: 'Faltan el nombre o la duración' };
      const created = await createTreatment({
        tenantId,
        name,
        description: typeof f.description === 'string' ? f.description : null,
        durationMinutes: duration,
        priceMin: typeof f.priceMin === 'number' ? String(f.priceMin) : null,
        priceMax: typeof f.priceMax === 'number' ? String(f.priceMax) : null,
        priceCents: typeof f.priceMin === 'number' ? Math.round(f.priceMin * 100) : null,
        currency: typeof f.currency === 'string' ? f.currency : 'EUR',
        active: true,
      });
      await recordAudit({
        tenantId,
        actorUserId: userId,
        action: 'create',
        entity: 'treatment',
        entityId: created?.id,
        after: created,
      });
      return { ok: true, summary: `Tratamiento "${name}" añadido` };
    }

    if (!change.targetId) return { ok: false, error: 'No se sabe qué tratamiento cambiar' };
    const before = await getTreatmentById(tenantId, change.targetId);
    if (!before) return { ok: false, error: 'Ese tratamiento ya no existe' };

    // "Ya no lo hacemos" es desactivar, nunca borrar: el tratamiento está
    // referenciado por las citas y por los profesionales que lo realizan, y
    // borrarlo se llevaría por delante el historial.
    if (change.op === 'DEACTIVATE' || change.op === 'ACTIVATE') {
      const active = change.op === 'ACTIVATE';
      const after = await updateTreatment(tenantId, change.targetId, { active });
      await recordAudit({
        tenantId,
        actorUserId: userId,
        action: 'update',
        entity: 'treatment',
        entityId: change.targetId,
        before,
        after,
      });
      return {
        ok: true,
        summary: active
          ? `"${before.name}" se vuelve a ofrecer`
          : `"${before.name}" ya no se ofrece`,
      };
    }

    const after = await updateTreatment(tenantId, change.targetId, {
      ...(typeof f.name === 'string' ? { name: f.name } : {}),
      ...('description' in f ? { description: (f.description as string) ?? null } : {}),
      ...(typeof f.durationMinutes === 'number' ? { durationMinutes: f.durationMinutes } : {}),
      ...(typeof f.priceMin === 'number'
        ? { priceMin: String(f.priceMin), priceCents: Math.round(f.priceMin * 100) }
        : {}),
      ...(typeof f.priceMax === 'number' ? { priceMax: String(f.priceMax) } : {}),
      ...(typeof f.currency === 'string' ? { currency: f.currency } : {}),
    });
    await recordAudit({
      tenantId,
      actorUserId: userId,
      action: 'update',
      entity: 'treatment',
      entityId: change.targetId,
      before,
      after,
    });
    return { ok: true, summary: `"${after?.name ?? before.name}" actualizado` };
  }

  if (change.entity === 'FAQ') {
    if (change.op === 'CREATE') {
      const question = typeof f.question === 'string' ? f.question : null;
      const answer = typeof f.answer === 'string' ? f.answer : null;
      if (!question || !answer) return { ok: false, error: 'Faltan la pregunta o la respuesta' };
      const created = await createFaq({
        tenantId,
        question,
        answer,
        category: typeof f.category === 'string' ? f.category : null,
        priority: 5,
      });
      await recordAudit({
        tenantId,
        actorUserId: userId,
        action: 'create',
        entity: 'faq',
        entityId: created?.id,
        after: created,
      });
      return { ok: true, summary: 'Pregunta frecuente añadida' };
    }

    if (!change.targetId) return { ok: false, error: 'No se sabe qué pregunta cambiar' };
    const before = await getFaqById(tenantId, change.targetId);
    if (!before) return { ok: false, error: 'Esa pregunta ya no existe' };

    if (change.op === 'DELETE') {
      await deleteFaq(tenantId, change.targetId);
      await recordAudit({
        tenantId,
        actorUserId: userId,
        action: 'delete',
        entity: 'faq',
        entityId: change.targetId,
        before,
      });
      return { ok: true, summary: 'Pregunta frecuente borrada' };
    }

    const after = await updateFaq(tenantId, change.targetId, {
      ...(typeof f.question === 'string' ? { question: f.question } : {}),
      ...(typeof f.answer === 'string' ? { answer: f.answer } : {}),
      ...('category' in f ? { category: (f.category as string) ?? null } : {}),
    });
    await recordAudit({
      tenantId,
      actorUserId: userId,
      action: 'update',
      entity: 'faq',
      entityId: change.targetId,
      before,
      after,
    });
    return { ok: true, summary: 'Pregunta frecuente actualizada' };
  }

  // CLINIC
  const before = await getClinicSettings(tenantId);
  if (!before) return { ok: false, error: 'Esta clínica no tiene ficha todavía' };
  const patch: Record<string, unknown> = {};
  if (typeof f.address === 'string') patch.address = f.address;
  if (Array.isArray(f.phones)) patch.phones = f.phones.filter((p) => typeof p === 'string');
  if (typeof f.transferNumber === 'string') patch.transferNumber = f.transferNumber;
  if (Object.keys(patch).length === 0) return { ok: false, error: 'No hay nada que cambiar' };

  const after = await updateClinicSettings(tenantId, patch);
  await recordAudit({
    tenantId,
    actorUserId: userId,
    action: 'update',
    entity: 'clinic_settings',
    entityId: tenantId,
    before,
    after,
  });
  return { ok: true, summary: 'Datos de la clínica actualizados' };
}
