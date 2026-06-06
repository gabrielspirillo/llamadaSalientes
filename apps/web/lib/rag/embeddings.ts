import 'server-only';

import { eq, isNull } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { faqs, treatments } from '@/lib/db/schema';
import { embedText } from '@/lib/openai/client';

/**
 * RAG sin pgvector: embeddings guardados como jsonb (float[]) y coseno en
 * memoria. El set de FAQs/tratamientos por tenant es chico, así que ranquear
 * unos cientos de vectores en JS es trivial y evita infra nueva.
 * (cosineSimilarity vive en ./cosine para poder testearlo aislado.)
 */

export function faqEmbeddingText(f: {
  question: string;
  answer: string;
  category?: string | null;
}): string {
  return [f.category, f.question, f.answer].filter(Boolean).join('\n');
}

export function treatmentEmbeddingText(t: {
  name: string;
  description?: string | null;
}): string {
  return [t.name, t.description].filter(Boolean).join('. ');
}

/** Embebe una FAQ y guarda el vector. Best-effort: loguea y sale ante error. */
export async function refreshFaqEmbedding(faqId: string): Promise<void> {
  try {
    const rows = await db
      .select({ question: faqs.question, answer: faqs.answer, category: faqs.category })
      .from(faqs)
      .where(eq(faqs.id, faqId))
      .limit(1);
    const f = rows[0];
    if (!f) return;
    const vec = await embedText(faqEmbeddingText(f));
    if (vec.length) await db.update(faqs).set({ embedding: vec }).where(eq(faqs.id, faqId));
  } catch (err) {
    console.warn('[rag] refreshFaqEmbedding falló', { faqId, err: (err as Error).message });
  }
}

/** Embebe un tratamiento y guarda el vector. Best-effort. */
export async function refreshTreatmentEmbedding(treatmentId: string): Promise<void> {
  try {
    const rows = await db
      .select({ name: treatments.name, description: treatments.description })
      .from(treatments)
      .where(eq(treatments.id, treatmentId))
      .limit(1);
    const t = rows[0];
    if (!t) return;
    const vec = await embedText(treatmentEmbeddingText(t));
    if (vec.length)
      await db.update(treatments).set({ embedding: vec }).where(eq(treatments.id, treatmentId));
  } catch (err) {
    console.warn('[rag] refreshTreatmentEmbedding falló', {
      treatmentId,
      err: (err as Error).message,
    });
  }
}

/**
 * Embebe todas las FAQs/tratamientos que aún no tienen embedding. Idempotente.
 * Usado por el script de backfill (pnpm rag:backfill).
 */
export async function backfillEmbeddings(): Promise<{ faqs: number; treatments: number }> {
  const faqRows = await db.select({ id: faqs.id }).from(faqs).where(isNull(faqs.embedding));
  for (const r of faqRows) await refreshFaqEmbedding(r.id);

  const treatmentRows = await db
    .select({ id: treatments.id })
    .from(treatments)
    .where(isNull(treatments.embedding));
  for (const r of treatmentRows) await refreshTreatmentEmbedding(r.id);

  return { faqs: faqRows.length, treatments: treatmentRows.length };
}
