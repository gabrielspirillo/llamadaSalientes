import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db/client';
import { waitlistOffers } from '@/lib/db/schema';
import { removeWaitlistOfferExpireJob, removeWaitlistOfferSendJob } from '@/lib/queue/client';
import { WaitlistForbiddenError, requireWaitlistRole } from '@/lib/waitlist/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/waitlist/offers/[id]/cancel — cancela manualmente una oferta activa.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { tenantId } = await requireWaitlistRole('operator');
    const { id } = await params;

    const [offer] = await db
      .select({ status: waitlistOffers.status })
      .from(waitlistOffers)
      .where(and(eq(waitlistOffers.tenantId, tenantId), eq(waitlistOffers.id, id)))
      .limit(1);
    if (!offer) return NextResponse.json({ error: 'Oferta no encontrada' }, { status: 404 });
    if (offer.status !== 'PENDING' && offer.status !== 'SENT') {
      return NextResponse.json(
        { error: `Oferta ya está en estado ${offer.status}` },
        { status: 409 },
      );
    }

    await db
      .update(waitlistOffers)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(eq(waitlistOffers.id, id));
    await Promise.all([removeWaitlistOfferSendJob(id), removeWaitlistOfferExpireJob(id)]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof WaitlistForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error('[api/waitlist/offers/[id]/cancel]', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
