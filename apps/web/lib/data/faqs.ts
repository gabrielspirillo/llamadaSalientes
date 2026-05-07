import 'server-only';
import { db } from '@/lib/db/client';
import { faqs } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

export type Faq = typeof faqs.$inferSelect;
export type NewFaq = typeof faqs.$inferInsert;

export async function listFaqsForTenant(tenantId: string) {
  return db
    .select()
    .from(faqs)
    .where(eq(faqs.tenantId, tenantId))
    .orderBy(desc(faqs.priority), faqs.question);
}

export async function getFaqById(tenantId: string, id: string) {
  const rows = await db
    .select()
    .from(faqs)
    .where(and(eq(faqs.tenantId, tenantId), eq(faqs.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createFaq(values: NewFaq) {
  const [row] = await db.insert(faqs).values(values).returning();
  return row;
}

export async function updateFaq(tenantId: string, id: string, patch: Partial<NewFaq>) {
  const [row] = await db
    .update(faqs)
    .set(patch)
    .where(and(eq(faqs.tenantId, tenantId), eq(faqs.id, id)))
    .returning();
  return row;
}

export async function deleteFaq(tenantId: string, id: string) {
  await db.delete(faqs).where(and(eq(faqs.tenantId, tenantId), eq(faqs.id, id)));
}
