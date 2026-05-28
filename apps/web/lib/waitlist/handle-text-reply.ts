import 'server-only';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  waitlistEntries,
  waitlistOffers,
  whatsappContacts,
} from '@/lib/db/schema';
import {
  removeWaitlistOfferExpireJob,
  removeWaitlistOfferSendJob,
} from '@/lib/queue/client';
import { markOfferAccepted, markOfferDeclined } from '@/lib/waitlist/engine';

// ─────────────────────────────────────────────────────────────────────────────
// Parser de respuestas de texto libre para ofertas de waitlist.
//
// Evolution + Baileys no entrega botones interactivos de forma confiable, así
// que mandamos texto con hints ("Acepto" / "No puedo"). Cuando llega inbound
// con una variante de aceptación o rechazo, buscamos la última oferta ACTIVA
// (SENT) del contacto y la resolvemos.
//
// Si el contacto no tiene oferta activa, no consumimos el evento — el agente
// WA recibe el mensaje como cualquier otro inbound.
// ─────────────────────────────────────────────────────────────────────────────

type Intent = 'accept' | 'decline' | null;

const ACCEPT_PATTERNS = [
  /\bacept(o|amos|a)\b/i,
  /\bsi\b/i,
  /\bsí\b/i,
  /\bok\b/i,
  /\bdale\b/i,
  /\bok[ae]y\b/i,
  /\bperfecto\b/i,
  /\bme sirve\b/i,
  /\bla tomo\b/i,
  /\bquiero\b/i,
];

const DECLINE_PATTERNS = [
  /\bno puedo\b/i,
  /\bno me sirve\b/i,
  /\bno gracias\b/i,
  /\brechazo\b/i,
  /\bno la tomo\b/i,
  /\bno quiero\b/i,
  /\bimposible\b/i,
  /^\s*no\s*[.!]?\s*$/i,
];

export function classifyWaitlistText(text: string): Intent {
  const t = text.trim();
  if (!t) return null;
  // El "no" simple debe matchear ANTES del "si" simple para evitar que "no" se
  // confunda con "si" por accidente (no debería pasar pero por orden).
  for (const re of DECLINE_PATTERNS) if (re.test(t)) return 'decline';
  for (const re of ACCEPT_PATTERNS) if (re.test(t)) return 'accept';
  return null;
}

export async function tryHandleWaitlistTextReply(args: {
  tenantId: string;
  contactPhoneE164: string;
  text: string | null | undefined;
}): Promise<{ consumed: boolean; intent?: 'accept' | 'decline' }> {
  const text = (args.text ?? '').trim();
  if (!text) return { consumed: false };

  const intent = classifyWaitlistText(text);
  if (!intent) return { consumed: false };

  // Buscar última oferta activa (PENDING / SENT) para el contacto. Joinea por
  // whatsappContacts.phoneE164 → ghlContactId que está en waitlist_entries.
  const [contact] = await db
    .select({ ghlContactId: whatsappContacts.ghlContactId })
    .from(whatsappContacts)
    .where(
      and(
        eq(whatsappContacts.tenantId, args.tenantId),
        eq(whatsappContacts.phoneE164, args.contactPhoneE164),
      ),
    )
    .limit(1);
  if (!contact?.ghlContactId) return { consumed: false };

  const [offer] = await db
    .select({ id: waitlistOffers.id, status: waitlistOffers.status })
    .from(waitlistOffers)
    .innerJoin(waitlistEntries, eq(waitlistEntries.id, waitlistOffers.waitlistEntryId))
    .where(
      and(
        eq(waitlistOffers.tenantId, args.tenantId),
        eq(waitlistEntries.ghlContactId, contact.ghlContactId),
        inArray(waitlistOffers.status, ['PENDING', 'SENT']),
      ),
    )
    .orderBy(desc(waitlistOffers.sentAt))
    .limit(1);
  if (!offer) return { consumed: false };

  if (intent === 'accept') {
    await markOfferAccepted({ offerId: offer.id, via: 'text' });
  } else {
    await markOfferDeclined({ offerId: offer.id, via: 'text' });
  }
  await Promise.all([
    removeWaitlistOfferExpireJob(offer.id),
    removeWaitlistOfferSendJob(offer.id),
  ]);
  return { consumed: true, intent };
}
