import 'server-only';
import { db } from '@/lib/db/client';
import { clinicSettings, tenants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export type ClinicSettings = typeof clinicSettings.$inferSelect;
export type TenantRow = typeof tenants.$inferSelect;

export type WorkingHours = Record<
  'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday',
  { open: string; close: string } | null
>;

export async function getClinicSettings(tenantId: string) {
  const rows = await db
    .select()
    .from(clinicSettings)
    .where(eq(clinicSettings.tenantId, tenantId))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateClinicSettings(
  tenantId: string,
  patch: Partial<typeof clinicSettings.$inferInsert>,
) {
  const [row] = await db
    .update(clinicSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(clinicSettings.tenantId, tenantId))
    .returning();
  if (row) return row;
  // Sin fila (clínica dada de alta a medias), el UPDATE no tocaba nada y el
  // panel decía "guardado". Se crea con lo que llega.
  const [inserted] = await db
    .insert(clinicSettings)
    .values({ ...patch, tenantId } as typeof clinicSettings.$inferInsert)
    .onConflictDoUpdate({
      target: clinicSettings.tenantId,
      set: { ...patch, updatedAt: new Date() },
    })
    .returning();
  return inserted;
}

export async function getTenant(tenantId: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return rows[0] ?? null;
}
