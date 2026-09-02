import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { badRequest, messagingErrorResponse } from '@/lib/messaging/api';
import { requireMessagingRole } from '@/lib/messaging/auth';
import { loadSettings, saveSettings } from '@/lib/messaging/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa el formato HH:MM');

// `nullish` en todo lo que el formulario puede dejar vacío: el cliente manda
// null explícito para borrar una franja, y `optional()` solo acepta undefined.
const patchSchema = z.object({
  sound: z.boolean().optional(),
  desktopPush: z.boolean().optional(),
  dndFrom: hhmm.nullish(),
  dndTo: hhmm.nullish(),
  // Tope de 24 h: más allá de eso el aviso ya no sirve para nada.
  escalateMentionsAfterMinutes: z.number().int().min(0).max(1440).optional(),
  statusEmoji: z.string().trim().max(8).nullish(),
  statusText: z.string().trim().max(80).nullish(),
  statusUntil: z.string().datetime({ offset: true }).nullish(),
});

export async function GET(): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const settings = await loadSettings(auth.tenantId, auth.userId);
    return NextResponse.json({ settings });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);

    // Una franja a medias no silencia nada y confunde: se exigen las dos o ninguna.
    const { dndFrom, dndTo } = parsed.data;
    if ((dndFrom ?? null) === null ? (dndTo ?? null) !== null : (dndTo ?? null) === null) {
      if (dndFrom !== undefined || dndTo !== undefined) {
        return badRequest([
          { message: 'Indica la hora de inicio y la de fin, o ninguna.', path: ['dndFrom'] },
        ]);
      }
    }

    const settings = await saveSettings(auth.tenantId, auth.userId, parsed.data);
    return NextResponse.json({ settings });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}
