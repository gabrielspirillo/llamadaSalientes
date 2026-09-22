import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { completeConsent, getEsignIntegration } from '@/lib/consents/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook de Documenso: "el tutor ha firmado".
 *
 * La clínica va en la URL porque cada una tiene su instancia de Documenso y su
 * propio secreto; el aviso no trae nada que diga de qué clínica es. El secreto
 * llega en `X-Documenso-Secret` en claro (no es un HMAC) y se compara en
 * tiempo constante contra el guardado —cifrado— en `esign_integrations`.
 *
 * Sin secreto válido no se toca la base. Es la invariante de todo webhook.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

interface DocumensoWebhook {
  event?: string;
  payload?: {
    id?: number;
    externalId?: string | null;
    status?: string;
    completedAt?: string | null;
    recipients?: { signingStatus?: string }[];
    Recipient?: { signingStatus?: string }[];
  };
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ tenantId: string }> },
): Promise<NextResponse> {
  const { tenantId } = await ctx.params;
  if (!UUID.test(tenantId)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const integration = await getEsignIntegration(tenantId).catch(() => null);
  if (!integration || !integration.active) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const secret = req.headers.get('x-documenso-secret') ?? '';
  if (!secret || !safeEqual(secret, integration.webhookSecret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as DocumensoWebhook | null;
  if (!body?.event || !body.payload) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const recipients = body.payload.recipients ?? body.payload.Recipient ?? [];
  const allSigned = recipients.length > 0 && recipients.every((r) => r.signingStatus === 'SIGNED');
  const completed =
    body.event === 'DOCUMENT_COMPLETED' ||
    body.payload.status === 'COMPLETED' ||
    (body.event === 'DOCUMENT_SIGNED' && allSigned);

  if (!completed) return NextResponse.json({ ok: true, ignored: body.event });

  try {
    const result = await completeConsent({
      tenantId,
      providerDocumentId: typeof body.payload.id === 'number' ? body.payload.id : null,
      externalId: body.payload.externalId ?? null,
      completedAt: body.payload.completedAt ? new Date(body.payload.completedAt) : new Date(),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // 500 a propósito: que Documenso lo reintente. El PDF firmado no puede
    // perderse por un corte de red con el bucket.
    const message = (err as Error).message ?? 'error desconocido';
    console.error('[webhooks/documenso] no se pudo cerrar el consentimiento', {
      tenantId,
      documentId: body.payload.id,
      err: message,
    });
    // El motivo viaja en la respuesta: el registro de webhooks de Documenso lo
    // enseña y es la única ventana a este error sin entrar al servidor.
    return NextResponse.json({ error: 'retry', detail: message.slice(0, 300) }, { status: 500 });
  }
}
