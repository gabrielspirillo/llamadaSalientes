import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Handler para llamadas Twilio que solo necesitan capturar audio de una voz
 * automática (típicamente OTPs de verificación: Meta WhatsApp Business, Stripe,
 * etc.). Devuelve TwiML que graba hasta 60s con transcripción habilitada.
 *
 * Uso: apuntar `VoiceUrl` del IncomingPhoneNumber acá, esperar la llamada,
 * leer transcripción en Twilio Console → Voice → Recordings, y revertir
 * VoiceUrl al destino original.
 *
 * `from` y `to` opcionales en la query string acotan a un solo originador o
 * destinatario; si vienen y no matchean, devolvemos `<Hangup/>` para no
 * interferir con tráfico legítimo de otros nros del mismo Twilio account.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));
  const from = params.From ?? '?';
  const to = params.To ?? '?';

  console.log('[twilio-voice-record]', { from, to, callSid: params.CallSid });

  const filterTo = req.nextUrl.searchParams.get('to');
  const filterFrom = req.nextUrl.searchParams.get('from');
  if ((filterTo && filterTo !== to) || (filterFrom && filterFrom !== from)) {
    const hangup = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';
    return new NextResponse(hangup, {
      status: 200,
      headers: { 'content-type': 'text/xml; charset=utf-8' },
    });
  }

  // Pause 1s para no perder el "hello" inicial; luego Record hasta 60s o 8s de
  // silencio. transcribe=true encola la transcripción Twilio (queda en el
  // mismo Recording resource).
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Record maxLength="60" playBeep="false" timeout="8" finishOnKey="" transcribe="true"/>
</Response>`;

  return new NextResponse(xml, {
    status: 200,
    headers: { 'content-type': 'text/xml; charset=utf-8' },
  });
}
