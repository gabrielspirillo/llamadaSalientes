import 'server-only';
import { and, eq, gt, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { usageMinutes } from '@/lib/db/schema';
import { getTenantTimezone } from '@/lib/tasks/materialize';
import { localDateKey } from '@/lib/tasks/tz';

const tzCache = new Map<string, { at: number; tz: string }>();

async function timezoneFor(tenantId: string): Promise<string> {
  const hit = tzCache.get(tenantId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.tz;
  const tz = await getTenantTimezone(tenantId).catch(() => 'Europe/Madrid');
  tzCache.set(tenantId, { at: Date.now(), tz });
  return tz;
}

/**
 * Suma un minuto de uso. Como mucho uno cada 50 s por persona aunque tenga
 * varias pestañas abiertas: si ya se contó uno hace menos, no hace nada.
 * Devuelve si contó.
 */
export async function recordUsageMinute(
  tenantId: string,
  userId: string,
  section: string,
  now = new Date(),
): Promise<boolean> {
  const day = localDateKey(now, await timezoneFor(tenantId));
  const recent = await db
    .select({ section: usageMinutes.section })
    .from(usageMinutes)
    .where(
      and(
        eq(usageMinutes.tenantId, tenantId),
        eq(usageMinutes.userId, userId),
        eq(usageMinutes.day, day),
        gt(usageMinutes.lastSeenAt, new Date(now.getTime() - 50_000)),
      ),
    )
    .limit(1);
  if (recent.length > 0) return false;
  await db
    .insert(usageMinutes)
    .values({ tenantId, userId, day, section, minutes: 1, firstSeenAt: now, lastSeenAt: now })
    .onConflictDoUpdate({
      target: [usageMinutes.tenantId, usageMinutes.userId, usageMinutes.day, usageMinutes.section],
      set: { minutes: sql`${usageMinutes.minutes} + 1`, lastSeenAt: now },
    });
  return true;
}
