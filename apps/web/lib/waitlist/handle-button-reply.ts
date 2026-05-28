import 'server-only';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { waitlistOffers } from '@/lib/db/schema';
import { extractInteractiveReplyId } from '@/lib/reminders/handle-button-reply';
import {
  removeWaitlistOfferExpireJob,
  removeWaitlistOfferSendJob,
} from '@/lib/queue/client';
import { markOfferAccepted, markOfferDeclined } from '@/lib/waitlist/engine';

// ─────────────────────────────────────────────────────────────────────────────
// Procesamiento de button replies de WhatsApp para waitlist offers.
//
// IDs de botones: `wlo:<accept|decline>:<offerId>` (ver template-resolver
// defaultWaitlistButtons). Cuando el paciente toca uno, el inbound trae ese
// id. Match acá, registra acción, transiciona estado de la oferta y dispara
// markOfferAccepted (con cascada en GHL) o markOfferDeclined (avanza cola).
// ─────────────────────────────────────────────────────────────────────────────

const BUTTON_RE = /^wlo:(accept|decline):([0-9a-f-]{8,})$/i;

export type WaitlistButtonAction = 'accept' | 'decline';

export function parseWaitlistButtonId(
  buttonId: string | null | undefined,
): { action: WaitlistButtonAction; offerId: string } | null {
  if (!buttonId) return null;
  const m = BUTTON_RE.exec(buttonId);
  if (!m) return null;
  return {
    action: m[1]!.toLowerCase() as WaitlistButtonAction,
    offerId: m[2]!,
  };
}

export async function handleWaitlistButtonReply(args: {
  tenantId: string;
  rawButtonId: string;
}): Promise<{ consumed: boolean; action?: WaitlistButtonAction }> {
  const parsed = parseWaitlistButtonId(args.rawButtonId);
  if (!parsed) return { consumed: false };

  const { action, offerId } = parsed;

  const [offer] = await db
    .select({ id: waitlistOffers.id, tenantId: waitlistOffers.tenantId })
    .from(waitlistOffers)
    .where(and(eq(waitlistOffers.tenantId, args.tenantId), eq(waitlistOffers.id, offerId)))
    .limit(1);
  if (!offer) {
    // El id matcheaba el regex pero la oferta no existe en este tenant. No
    // consumimos para que el flujo siga.
    return { consumed: false };
  }

  if (action === 'accept') {
    const res = await markOfferAccepted({ offerId, via: 'button' });
    await Promise.all([
      removeWaitlistOfferExpireJob(offerId),
      removeWaitlistOfferSendJob(offerId),
    ]);
    if (!res.ok) {
      console.warn('[waitlist] accept failed', res.reason);
    }
    return { consumed: true, action };
  }

  // action === 'decline'
  await markOfferDeclined({ offerId, via: 'button' });
  await Promise.all([
    removeWaitlistOfferExpireJob(offerId),
    removeWaitlistOfferSendJob(offerId),
  ]);
  return { consumed: true, action };
}

// Helper para route handlers: dado un raw + canal, decide si fue un button
// reply de waitlist y si lo consumimos.
export async function tryHandleWaitlistInbound(args: {
  tenantId: string;
  rawMessage: unknown;
  channel: 'WHATSAPP_CLOUD' | 'WHATSAPP_EVOLUTION' | 'WHATSAPP_TWILIO';
}): Promise<{ consumed: boolean; action?: WaitlistButtonAction }> {
  const replyId = extractInteractiveReplyId(args.rawMessage, args.channel);
  if (!replyId) return { consumed: false };
  return handleWaitlistButtonReply({
    tenantId: args.tenantId,
    rawButtonId: replyId,
  });
}
