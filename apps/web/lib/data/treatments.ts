import 'server-only';
import { db } from '@/lib/db/client';
import { treatments } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

export type Treatment = typeof treatments.$inferSelect;
export type NewTreatment = typeof treatments.$inferInsert;

export async function listTreatmentsForTenant(tenantId: string) {
  return db
    .select()
    .from(treatments)
    .where(eq(treatments.tenantId, tenantId))
    .orderBy(desc(treatments.active), treatments.name);
}

export async function getTreatmentById(tenantId: string, id: string) {
  const rows = await db
    .select()
    .from(treatments)
    .where(and(eq(treatments.tenantId, tenantId), eq(treatments.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createTreatment(values: NewTreatment) {
  const [row] = await db.insert(treatments).values(values).returning();
  return row;
}

export async function updateTreatment(tenantId: string, id: string, patch: Partial<NewTreatment>) {
  const [row] = await db
    .update(treatments)
    .set(patch)
    .where(and(eq(treatments.tenantId, tenantId), eq(treatments.id, id)))
    .returning();
  return row;
}

export async function deleteTreatment(tenantId: string, id: string) {
  await db.delete(treatments).where(and(eq(treatments.tenantId, tenantId), eq(treatments.id, id)));
}
