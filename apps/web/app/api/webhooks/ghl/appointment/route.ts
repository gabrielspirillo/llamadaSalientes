import { db } from '@/lib/db/client';
import { ghlIntegrations, webhookLogs } from '@/lib/db/schema';
import {
  recordCancelledSlot,
  tryAttributeNewAppointment,
} from '@/lib/analytics/slot-attribution';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook que GHL llama en eventos de citas. Alimenta el módulo de analytics
 * de slot-fill attribution (revenue recuperado por slots optimizados).
 *
 * Configurar en GHL:
 *   Settings → Integrations → Webhooks → New Outbound Webhook
 *     URL: https://<dominio>/api/webhooks/ghl/appointment?location=<locationId>
 *     Eventos: AppointmentCreate, AppointmentUpdate, AppointmentDelete
 *
 * Auth: matcheo por location → tenant. Sin firma en v1 (endurecer en prod).
 */
type GhlAppointmentPayload = {
  type?: string;
  locationId?: string;
  appointment?: {
    id?: string;
    calendarId?: string;
    contactId?: string;
    startTime?: string;
    endTime?: string;
    status?: string;
    treatmentId?: string;
    dateAdded?: string;
  };
};

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function classifyEvent(payload: GhlAppointmentPayload): 'create' | 'cancel' | null {
  const type = (payload.type ?? '').toLowerCase();
  const status = (payload.appointment?.status ?? '').toLowerCase();

  if (/appointment\.?delete/.test(type)) return 'cancel';
  if (status === 'cancelled' || status === 'canceled' || status === 'no_show') return 'cancel';
  if (/appointment\.?create/.test(type)) return 'create';
  return null;
}

export async function POST(req: NextRequest) {
  const locationFromQuery = req.nextUrl.searchParams.get('location') ?? '';
  let payload: GhlAppointmentPayload;
  try {
    payload = (await req.json()) as GhlAppointmentPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const locationId = payload.locationId ?? locationFromQuery;
  if (!locationId) {
    return NextResponse.json({ error: 'Falta locationId' }, { status: 400 });
  }

  const [integration] = await db
    .select({ tenantId: ghlIntegrations.tenantId })
    .from(ghlIntegrations)
    .where(eq(ghlIntegrations.locationId, locationId))
    .limit(1);

  if (!integration) {
    return NextResponse.json(
      { error: `Ningún tenant tiene la location ${locationId} integrada` },
      { status: 404 },
    );
  }

  await db
    .insert(webhookLogs)
    .values({
      tenantId: integration.tenantId,
      source: 'ghl',
      event: payload.type ?? 'unknown',
      signatureValid: null,
      statusCode: 200,
      body: payload as Record<string, unknown>,
    })
    .catch(() => undefined);

  const apt = payload.appointment;
  if (!apt?.id) {
    return NextResponse.json({ ok: true, skipped: 'no-appointment-id' });
  }

  const event = classifyEvent(payload);
  if (!event) {
    return NextResponse.json({ ok: true, ignored: payload.type ?? apt.status });
  }

  const startTime = parseDate(apt.startTime);
  if (!startTime) {
    return NextResponse.json({ ok: true, skipped: 'no-start-time' });
  }

  if (event === 'cancel') {
    await recordCancelledSlot({
      tenantId: integration.tenantId,
      ghlAppointmentId: apt.id,
      calendarId: apt.calendarId ?? null,
      treatmentId: apt.treatmentId ?? null,
      ghlContactId: apt.contactId ?? null,
      startTime,
      endTime: parseDate(apt.endTime),
    });
    return NextResponse.json({ ok: true, action: 'cancelled-slot-recorded' });
  }

  // event === 'create'
  const attribution = await tryAttributeNewAppointment({
    tenantId: integration.tenantId,
    ghlAppointmentId: apt.id,
    calendarId: apt.calendarId ?? null,
    treatmentId: apt.treatmentId ?? null,
    ghlContactId: apt.contactId ?? null,
    startTime,
    endTime: parseDate(apt.endTime),
    createdAt: parseDate(apt.dateAdded) ?? new Date(),
  });

  return NextResponse.json({
    ok: true,
    action: 'create',
    attributed: attribution !== null,
    ...(attribution ? { attribution } : {}),
  });
}
