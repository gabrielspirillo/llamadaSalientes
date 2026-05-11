import { triggerCallback } from '@/lib/calls/trigger-callback';
import { db } from '@/lib/db/client';
import { ghlIntegrations, webhookLogs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook que GHL llama cuando se crea/actualiza un contacto.
 *
 * Configurar en GHL:
 *   Settings → Integrations → Webhooks → New Outbound Webhook
 *     URL: https://<tu-dominio>/api/webhooks/ghl/contact?location=<locationId>
 *     Eventos: ContactCreate (al menos)
 *
 * Auth: matcheamos por location → tenant_id. No requiere firma para v1.
 * (Para producción endurecer con header secreto compartido).
 *
 * Payload esperado (shape GHL):
 *   { type: "ContactCreate", locationId: "...", contact: { id, firstName, lastName, phone, email, ... } }
 */
type GhlWebhookPayload = {
  type?: string;
  locationId?: string;
  contact?: {
    id?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
  };
};

export async function POST(req: NextRequest) {
  const locationFromQuery = req.nextUrl.searchParams.get('location') ?? '';
  let payload: GhlWebhookPayload;
  try {
    payload = (await req.json()) as GhlWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const locationId = payload.locationId ?? locationFromQuery;
  if (!locationId) {
    return NextResponse.json({ error: 'Falta locationId' }, { status: 400 });
  }

  // Resolver tenant por locationId en ghl_integrations
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

  // Log (no firmamos por ahora — para producción agregar HMAC compartido)
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

  // Solo procesamos ContactCreate; ignoramos updates y otros eventos
  if (payload.type && !/^contact\.?create$/i.test(payload.type)) {
    return NextResponse.json({ ok: true, ignored: payload.type });
  }

  const phone = payload.contact?.phone;
  if (!phone) {
    return NextResponse.json({ ok: true, skipped: 'no-phone' });
  }

  const fullName = [payload.contact?.firstName, payload.contact?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();

  const result = await triggerCallback({
    tenantId: integration.tenantId,
    toNumber: phone,
    patientName: fullName || null,
    email: payload.contact?.email ?? null,
    ghlContactId: payload.contact?.id ?? null,
    source: 'ghl_webhook',
    createContactIfMissing: false, // ya viene de GHL
  });

  // Guardamos el resultado en el log para debugging
  await db
    .insert(webhookLogs)
    .values({
      tenantId: integration.tenantId,
      source: 'ghl',
      event: 'callback_result',
      signatureValid: null,
      statusCode: result.ok ? 200 : 400,
      body: result as unknown as Record<string, unknown>,
    })
    .catch(() => undefined);

  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason, error: result.error });
  }

  return NextResponse.json({ ok: true, callId: result.callId });
}
