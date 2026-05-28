import 'server-only';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { waitlistOffers } from '@/lib/db/schema';
import type { QueueJobs } from '@/lib/queue/queues';
import type { StepRunner } from '@/lib/queue/step';
import { expireOfferAndAdvance } from '@/lib/waitlist/engine';

// Handler de la queue 'waitlist-offer-expire'.
//
// Si la oferta sigue PENDING/SENT al dispararse, la marca EXPIRED y avanza al
// siguiente paciente de la cola para el mismo slot. Idempotente: si la oferta
// ya fue respondida (accept/decline) o ya está EXPIRED, no-op.

export async function processWaitlistOfferExpireJob(
  data: QueueJobs['waitlist-offer-expire'],
  step: StepRunner,
): Promise<{ status: 'expired' | 'skipped' | 'failed'; reason?: string }> {
  return step.run('process-waitlist-offer-expire', async () => {
    const { tenantId, offerId } = data;

    const [offer] = await db
      .select({ id: waitlistOffers.id, status: waitlistOffers.status })
      .from(waitlistOffers)
      .where(and(eq(waitlistOffers.tenantId, tenantId), eq(waitlistOffers.id, offerId)))
      .limit(1);
    if (!offer) return { status: 'skipped', reason: 'not_found' };
    if (offer.status !== 'PENDING' && offer.status !== 'SENT') {
      return { status: 'skipped', reason: `already_${offer.status.toLowerCase()}` };
    }

    const result = await expireOfferAndAdvance(offerId);
    if (result.ok) return { status: 'expired' };
    return { status: 'expired', reason: result.reason };
  });
}
