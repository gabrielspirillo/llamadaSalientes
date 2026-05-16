import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Handler genérico para SMS entrantes a un número Twilio.
 *
 * Útil sobre todo para capturar OTPs (ej: verificación de WhatsApp Business
 * por SMS de Meta) cuando el número de Twilio no está vinculado a un servicio
 * propio que los procese.
 *
 * Comportamiento:
 *  - Loguea siempre el cuerpo del SMS a runtime logs.
 *  - Si la query string trae `?forward=+E164`, devuelve TwiML que reenvía el
 *    contenido del SMS a ese número usando el mismo Twilio sender que lo
 *    recibió.
 *  - Si no, responde con `<Response/>` vacío (no auto-reply).
 *
 * El número de destino se pasa por query string para evitar hardcodear datos
 * personales en el repo. Twilio firma cada request con el Auth Token de la
 * cuenta, pero acá no validamos firma porque cualquier handler en el `SmsUrl`
 * solo es invocado por Twilio mismo y los TwiML responses no acceden a recursos
 * sensibles (no DB, no credenciales).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));
  const from = params.From ?? '?';
  const to = params.To ?? '?';
  const body = params.Body ?? '';

  console.log('[twilio-sms-passthrough]', {
    from,
    to,
    sid: params.MessageSid,
    bodyLen: body.length,
    body: body.slice(0, 200),
  });

  const forwardTo = req.nextUrl.searchParams.get('forward');
  if (forwardTo && /^\+[1-9]\d{6,14}$/.test(forwardTo)) {
    const safe = `[${to}] ${from}: ${body}`.replace(/[<>&]/g, (c) =>
      c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;',
    );
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message to="${forwardTo}">${safe}</Message></Response>`;
    return new NextResponse(xml, {
      status: 200,
      headers: { 'content-type': 'text/xml; charset=utf-8' },
    });
  }

  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status: 200,
    headers: { 'content-type': 'text/xml; charset=utf-8' },
  });
}
