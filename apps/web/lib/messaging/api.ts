import 'server-only';
import { NextResponse } from 'next/server';

import {
  MessagingForbiddenError,
  MessagingNotFoundError,
  NotChannelMemberError,
} from '@/lib/messaging/auth';

/** Traduce los errores del módulo a códigos HTTP. Un solo lugar. */
export function messagingErrorResponse(err: unknown): NextResponse {
  if (err instanceof MessagingForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  // Un no-miembro recibe 404, no 403: un canal privado no debe revelar que existe.
  if (err instanceof NotChannelMemberError || err instanceof MessagingNotFoundError) {
    return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  }
  const message = (err as Error)?.message ?? 'Unauthorized';
  if (/Unauthenticated|No active organization/.test(message)) {
    return NextResponse.json({ error: message }, { status: 401 });
  }
  console.error('[messaging-api] error', err);
  return NextResponse.json({ error: 'Error interno' }, { status: 500 });
}

export function badRequest(issues: unknown): NextResponse {
  return NextResponse.json({ error: 'Datos inválidos', issues }, { status: 400 });
}
