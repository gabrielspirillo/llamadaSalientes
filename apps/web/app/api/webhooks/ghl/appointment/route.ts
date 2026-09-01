import { db } from '@/lib/db/client';
import { ghlIntegrations, webhookLogs } from '@/lib/db/schema';
import {
  recordCancelledSlot,
  tryAttributeNewAppointment,
} from '@/lib/analytics/slot-attribution';
import {
  type GhlAppointmentPayload,
  classifyEvent,
  normalizeAppointment,
  parseDate,
} from '@/lib/analytics/ghl-webhook-helpers';
import {
  deleteAppointmentCache,
  upsertAppointmentCache,
} from '@/lib/appointments/cache';
import {
  onAppointmentCancelled,
  onAppointmentCompleted,
  onAppointmentNoShow,
} from '@/lib/tasks/hooks';
import {
  autoEnqueueOnNewAppointment,
  enqueueOfferForCancelledSlot,
} from '@/lib/waitlist/engine';
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
export async function POST(req: NextRequest) {
  const locationFromQuery = req.nextUrl.searchParams.get('location') ?? '';
  let payload: GhlAppointmentPayload;
  try {
    payload = (await req.json()) as GhlAppointmentPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { appointment: apt, locationId: locationFromPayload, type: eventType } =
    normalizeAppointment(payload);
  const locationId = locationFromPayload ?? locationFromQuery;
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
      event: eventType ?? apt.status ?? 'unknown',
      signatureValid: null,
      statusCode: 200,
      body: payload as Record<string, unknown>,
    })
    .catch(() => undefined);

  if (!apt.id) {
    return NextResponse.json({ ok: true, skipped: 'no-appointment-id' });
  }

  // Mantener `appointments_cache` al día con la cita en GHL. El cache lo
  // consume el inbox WhatsApp (sidebar + página de detalle del contacto).
  // El upsert NO depende de `classifyEvent`: queremos reflejar también
  // updates de status (showed / no-show / confirmado) que no son ni create
  // ni cancel para el módulo de analytics.
  const isCancel = isCancelType(eventType, apt.status);
  if (isCancel) {
    await deleteAppointmentCache({
      tenantId: integration.tenantId,
      ghlAppointmentId: apt.id,
    }).catch((err) =>
      console.warn('[ghl-webhook] cache delete failed', err),
    );
  } else {
    // Algunos shapes traen extras (title, assignedUserId) sólo en el payload
    // bruto, no en la versión normalizada — los leemos directo de payload.
    const rawApt = (payload as { appointment?: Record<string, unknown> }).appointment ?? {};
    await upsertAppointmentCache({
      tenantId: integration.tenantId,
      appt: {
        id: apt.id,
        contactId: apt.contactId ?? null,
        calendarId: apt.calendarId ?? null,
        appointmentStatus: apt.status ?? null,
        assignedUserId: (rawApt.assignedUserId as string | undefined) ?? null,
        title: (rawApt.title as string | undefined) ?? null,
        startTime: apt.startTime ?? null,
        endTime: apt.endTime ?? null,
      },
    }).catch((err) =>
      console.warn('[ghl-webhook] cache upsert failed', err),
    );
  }

  // ── Tareas: los pendientes humanos que nacen de la cita ────────────────────
  // Va antes de classifyEvent a propósito: los cambios de status (no-show,
  // asistió) no son ni create ni cancel para analytics, pero sí generan trabajo
  // para recepción. Awaited con catch interno: el webhook no se rompe por esto.
  const apptStart = parseDate(apt.startTime);
  const statusLower = (apt.status ?? '').toLowerCase();
  if (isCancel) {
    await onAppointmentCancelled({
      tenantId: integration.tenantId,
      ghlAppointmentId: apt.id,
      ghlContactId: apt.contactId ?? null,
      startTime: apptStart,
    });
    // Mensajes: la cita cancelada se anuncia en #agenda con Reagendar /
    // Liberar el hueco. Best-effort, no puede romper el webhook.
    await publishAppointmentEvent('cancelled', {
      tenantId: integration.tenantId,
      ghlAppointmentId: apt.id,
      ghlContactId: apt.contactId ?? null,
      startTime: apptStart,
    });
  } else if (NO_SHOW_STATUSES.has(statusLower)) {
    await onAppointmentNoShow({
      tenantId: integration.tenantId,
      ghlAppointmentId: apt.id,
      ghlContactId: apt.contactId ?? null,
      startTime: apptStart,
    });
    await publishAppointmentEvent('no_show', {
      tenantId: integration.tenantId,
      ghlAppointmentId: apt.id,
      ghlContactId: apt.contactId ?? null,
      startTime: apptStart,
    });
  } else if (ATTENDED_STATUSES.has(statusLower)) {
    await onAppointmentCompleted({
      tenantId: integration.tenantId,
      ghlAppointmentId: apt.id,
      ghlContactId: apt.contactId ?? null,
      startTime: apptStart,
      treatmentId: apt.treatmentId ?? null,
    });
  }

  const event = classifyEvent(payload);
  if (!event) {
    return NextResponse.json({ ok: true, cached: true, ignored: eventType ?? apt.status });
  }

  const startTime = parseDate(apt.startTime);
  if (!startTime) {
    return NextResponse.json({ ok: true, cached: true, skipped: 'no-start-time' });
  }

  if (event === 'cancel') {
    const cancelled = await recordCancelledSlot({
      tenantId: integration.tenantId,
      ghlAppointmentId: apt.id,
      calendarId: apt.calendarId ?? null,
      treatmentId: apt.treatmentId ?? null,
      ghlContactId: apt.contactId ?? null,
      startTime,
      endTime: parseDate(apt.endTime),
    });
    // Waitlist: encolar oferta para el siguiente paciente elegible. No bloquea
    // la respuesta del webhook si falla (es best-effort).
    const offer = await enqueueOfferForCancelledSlot(integration.tenantId, cancelled.id).catch(
      (err) => {
        console.warn('[ghl-webhook] waitlist enqueue failed', err);
        return { ok: false as const, reason: 'engine_error' };
      },
    );
    return NextResponse.json({
      ok: true,
      action: 'cancelled-slot-recorded',
      cancelledSlotId: cancelled.id,
      waitlistOffer: offer.ok
        ? { offerId: offer.offerId, channel: offer.channel, expiresAt: offer.expiresAt }
        : { skipped: offer.reason },
    });
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

  // Waitlist: si el tratamiento es elegible y la cita cumple el umbral, anotar
  // al paciente en la cola FIFO. Idempotente. assignedUserId puede venir en el
  // payload bruto, no en la versión normalizada.
  const rawApt = (payload as { appointment?: Record<string, unknown> }).appointment ?? {};
  const autoEnqueue = await autoEnqueueOnNewAppointment({
    tenantId: integration.tenantId,
    ghlContactId: apt.contactId ?? null,
    ghlAppointmentId: apt.id,
    treatmentId: apt.treatmentId ?? null,
    calendarId: apt.calendarId ?? null,
    assignedUserId: (rawApt.assignedUserId as string | undefined) ?? null,
    startTime,
    endTime: parseDate(apt.endTime),
  }).catch((err) => {
    console.warn('[ghl-webhook] waitlist auto-enqueue failed', err);
    return { ok: false as const, reason: 'engine_error' };
  });

  return NextResponse.json({
    ok: true,
    action: 'create',
    attributed: attribution !== null,
    ...(attribution ? { attribution } : {}),
    waitlist: autoEnqueue.ok ? { entryId: autoEnqueue.entryId } : { skipped: autoEnqueue.reason },
  });
}

/**
 * Publica la tarjeta de la cita en el chat interno.
 *
 * Best-effort y con try/catch propio, igual que los hooks de Tareas: GHL
 * reintenta el webhook si devolvemos error, y no queremos reintentos por no
 * haber podido publicar un mensaje.
 */
async function publishAppointmentEvent(
  kind: 'cancelled' | 'no_show',
  args: {
    tenantId: string;
    ghlAppointmentId: string;
    ghlContactId: string | null;
    startTime: Date | null;
  },
): Promise<void> {
  try {
    const { resolvePatient } = await import('@/lib/tasks/hooks');
    const patient = await resolvePatient(args.tenantId, { ghlContactId: args.ghlContactId });
    const { postAppointmentCancelled, postAppointmentNoShow } = await import(
      '@/lib/messaging/bot'
    );
    const post = kind === 'cancelled' ? postAppointmentCancelled : postAppointmentNoShow;
    await post({
      tenantId: args.tenantId,
      ghlAppointmentId: args.ghlAppointmentId,
      patientName: patient.name,
      phone: patient.phone,
      startTime: args.startTime,
    });
  } catch (err) {
    console.warn('[ghl-webhook] publicar evento de cita falló', (err as Error).message);
  }
}

// GHL no normaliza el status de asistencia entre cuentas: aceptamos las
// variantes que aparecen en la práctica.
const NO_SHOW_STATUSES = new Set(['no_show', 'noshow', 'no-show']);
const ATTENDED_STATUSES = new Set(['showed', 'completed', 'attended']);

function isCancelType(eventType: string | undefined, status: string | undefined): boolean {
  const t = (eventType ?? '').toLowerCase();
  if (/appointment\.?delete/.test(t)) return true;
  const s = (status ?? '').toLowerCase();
  return s === 'cancelled' || s === 'canceled';
}
