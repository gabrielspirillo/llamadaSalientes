import { db } from '@/lib/db/client';
import { calls } from '@/lib/db/schema';
import { getContact } from '@/lib/ghl/contacts';
import { ghlFetch } from '@/lib/ghl/client';
import { getCurrentTenant } from '@/lib/tenant';
import { and, desc, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Detalle completo de un contacto:
 * - Datos básicos desde GHL
 * - Llamadas asociadas (por ghl_contact_id)
 * - Citas próximas/pasadas desde GHL
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let tenantId: string;
  try {
    const ctx = await getCurrentTenant();
    tenantId = ctx.tenant.id;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const contact = await getContact(tenantId, id);
  if (!contact) {
    return NextResponse.json({ error: 'Contacto no encontrado' }, { status: 404 });
  }

  // Llamadas del contacto en DB local
  const contactCalls = await db
    .select({
      id: calls.id,
      retellCallId: calls.retellCallId,
      fromNumber: calls.fromNumber,
      toNumber: calls.toNumber,
      startedAt: calls.startedAt,
      durationSeconds: calls.durationSeconds,
      intent: calls.intent,
      sentiment: calls.sentiment,
      summary: calls.summary,
      transferred: calls.transferred,
    })
    .from(calls)
    .where(and(eq(calls.tenantId, tenantId), eq(calls.ghlContactId, id)))
    .orderBy(desc(calls.startedAt))
    .limit(20);

  // Citas del contacto desde GHL
  type RawAppt = {
    id: string;
    calendarId?: string;
    startTime?: string;
    endTime?: string;
    appointmentStatus?: string;
    status?: string;
    title?: string;
  };
  let appointments: Array<{
    id: string;
    startTime: string;
    endTime?: string | null;
    status: string | null;
    title: string | null;
  }> = [];
  try {
    const data = await ghlFetch<{ events?: RawAppt[]; appointments?: RawAppt[] }>({
      tenantId,
      path: `/contacts/${id}/appointments`,
    });
    const items = data.events ?? data.appointments ?? [];
    appointments = items.map((a) => ({
      id: a.id,
      startTime: a.startTime ?? '',
      endTime: a.endTime ?? null,
      status: a.appointmentStatus ?? a.status ?? null,
      title: a.title ?? null,
    }));
  } catch (err) {
    console.error('[contact detail] GHL appointments fallo:', err);
  }

  return NextResponse.json({
    contact,
    calls: contactCalls,
    appointments,
  });
}
