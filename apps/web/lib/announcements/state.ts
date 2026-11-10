import 'server-only';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { announcementViews } from '@/lib/db/schema';

import { type AnnouncementState, snoozeUntil } from './catalog';

export async function loadAnnouncementStates(
  tenantId: string,
  userId: string,
): Promise<AnnouncementState[]> {
  const rows = await db
    .select({
      announcementId: announcementViews.announcementId,
      status: announcementViews.status,
      snoozeUntil: announcementViews.snoozeUntil,
    })
    .from(announcementViews)
    .where(and(eq(announcementViews.tenantId, tenantId), eq(announcementViews.userId, userId)));
  return rows.map((r) => ({
    announcementId: r.announcementId,
    status: r.status === 'DISMISSED' ? 'DISMISSED' : 'SNOOZED',
    snoozeUntil: r.snoozeUntil,
  }));
}

/** "Entendido" (no vuelve) o "Recordar más tarde" (vuelve en unas horas). */
export async function recordAnnouncementAction(
  tenantId: string,
  userId: string,
  announcementId: string,
  action: 'dismiss' | 'snooze',
  now = new Date(),
): Promise<void> {
  const status = action === 'dismiss' ? 'DISMISSED' : 'SNOOZED';
  const until = action === 'dismiss' ? null : snoozeUntil(now);
  await db
    .insert(announcementViews)
    .values({ tenantId, userId, announcementId, status, snoozeUntil: until, updatedAt: now })
    .onConflictDoUpdate({
      target: [
        announcementViews.tenantId,
        announcementViews.userId,
        announcementViews.announcementId,
      ],
      set: {
        status,
        snoozeUntil: until,
        timesShown: sql`${announcementViews.timesShown} + 1`,
        updatedAt: now,
      },
    });
}
