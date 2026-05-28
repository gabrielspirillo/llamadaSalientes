import 'server-only';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { tenants, waitlistOffers } from '@/lib/db/schema';
import type { QueueJobs } from '@/lib/queue/queues';
import { sendQueueEvent } from '@/lib/queue/client';
import type { StepRunner } from '@/lib/queue/step';
import { buildVarsForOffer } from '@/lib/waitlist/engine';
import {
  sendWaitlistWhatsApp,
  deriveContactDisplayNameFromWaitlistVars,
} from '@/lib/waitlist/send-whatsapp';
import { sendWaitlistVoice } from '@/lib/waitlist/send-voice';

// Handler de la queue 'waitlist-offer-send'.
//
// Idempotente: chequea status==PENDING. Si la oferta ya fue procesada (race
// con accept/decline manual), no-op.

export async function processWaitlistOfferSendJob(
  data: QueueJobs['waitlist-offer-send'],
  step: StepRunner,
): Promise<{ status: 'sent' | 'skipped' | 'failed'; reason?: string }> {
  return step.run('process-waitlist-offer-send', async () => {
    const { tenantId, offerId } = data;

    const [offer] = await db
      .select()
      .from(waitlistOffers)
      .where(and(eq(waitlistOffers.tenantId, tenantId), eq(waitlistOffers.id, offerId)))
      .limit(1);
    if (!offer) return { status: 'skipped', reason: 'not_found' };
    if (offer.status !== 'PENDING') {
      return { status: 'skipped', reason: `already_${offer.status.toLowerCase()}` };
    }

    const built = await buildVarsForOffer(offerId);
    if (!built) {
      await markStatus(offerId, 'CANCELLED', 'vars_unavailable');
      return { status: 'skipped', reason: 'vars_unavailable' };
    }
    const { vars, contactPhone } = built;
    if (!contactPhone) {
      await markStatus(offerId, 'CANCELLED', 'no_phone');
      return { status: 'skipped', reason: 'no_phone' };
    }

    // Patch clinic.name desde tenants.name si la clínica no tiene name aparte.
    const [t] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (t?.name) vars.clinic.name = t.name;

    const displayName = deriveContactDisplayNameFromWaitlistVars(vars);

    let externalMessageId: string | null = null;
    let externalCallId: string | null = null;

    if (offer.channel === 'WHATSAPP') {
      const res = await sendWaitlistWhatsApp({
        tenantId,
        offerId,
        toPhoneE164: contactPhone,
        vars,
        contactDisplayName: displayName,
      });
      if (!res.ok) {
        await markStatus(offerId, 'CANCELLED', res.reason);
        return { status: 'failed', reason: res.reason };
      }
      externalMessageId = res.externalMessageId;
    } else if (offer.channel === 'VOICE') {
      const res = await sendWaitlistVoice({
        tenantId,
        offerId,
        toPhoneE164: contactPhone,
        vars,
        contactDisplayName: displayName,
        ghlContactId: built.entry.ghlContactId,
      });
      if (!res.ok) {
        await markStatus(offerId, 'CANCELLED', res.reason);
        return { status: 'failed', reason: res.reason };
      }
      externalCallId = res.callId;
    } else {
      await markStatus(offerId, 'CANCELLED', 'unknown_channel');
      return { status: 'failed', reason: 'unknown_channel' };
    }

    await db
      .update(waitlistOffers)
      .set({
        status: 'SENT',
        sentAt: new Date(),
        externalMessageId,
        externalCallId,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(waitlistOffers.id, offerId));

    // Programar la expiración del TTL.
    const ms = offer.expiresAt.getTime() - Date.now();
    await sendQueueEvent(
      'waitlist-offer-expire',
      { tenantId, offerId },
      { delayMs: Math.max(0, ms) },
    );

    return { status: 'sent' };
  });
}

async function markStatus(
  offerId: string,
  status: 'CANCELLED' | 'EXPIRED',
  reason: string,
): Promise<void> {
  await db
    .update(waitlistOffers)
    .set({ status, errorMessage: reason, updatedAt: new Date() })
    .where(eq(waitlistOffers.id, offerId));
}
