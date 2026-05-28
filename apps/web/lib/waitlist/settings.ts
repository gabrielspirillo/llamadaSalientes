import 'server-only';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { waitlistSettings } from '@/lib/db/schema';

export type WaitlistSettingsRow = typeof waitlistSettings.$inferSelect;

// Lazy-crea la fila de settings con defaults sensatos. Idempotente.
export async function getOrCreateWaitlistSettings(tenantId: string): Promise<WaitlistSettingsRow> {
  const [existing] = await db
    .select()
    .from(waitlistSettings)
    .where(eq(waitlistSettings.tenantId, tenantId))
    .limit(1);
  if (existing) return existing;

  await db.insert(waitlistSettings).values({ tenantId }).onConflictDoNothing();

  const [row] = await db
    .select()
    .from(waitlistSettings)
    .where(eq(waitlistSettings.tenantId, tenantId))
    .limit(1);
  if (!row) throw new Error('getOrCreateWaitlistSettings: insert race sin row');
  return row;
}
