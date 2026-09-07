import { NextResponse } from 'next/server';

import { AgendaForbiddenError, getAgendaContext } from '@/lib/agenda/auth';
import { getAvailability } from '@/lib/agenda/queries';
import { minuteOfDay } from '@/lib/agenda/view';
import { localDateKey } from '@/lib/tasks/tz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Huecos libres de un profesional. Lo consume el alta de cita del calendario
 * para no obligar a recepción a adivinar dónde cabe.
 *
 * El `tenantId` sale SIEMPRE de la sesión, nunca de la query: el único
 * parámetro que llega del cliente es el profesional, y se comprueba que sea de
 * esta clínica (y, si quien pregunta es un profesional restringido, que sea él).
 */
export async function GET(req: Request) {
  let ctx: Awaited<ReturnType<typeof getAgendaContext>>;
  try {
    ctx = await getAgendaContext();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const professionalId = url.searchParams.get('professionalId');
  if (!professionalId) {
    return NextResponse.json({ error: 'Falta professionalId' }, { status: 400 });
  }

  try {
    if (ctx.scope === 'OWN' && ctx.professional?.id !== professionalId) {
      throw new AgendaForbiddenError('Sólo puedes consultar tu propia agenda.');
    }

    const today = localDateKey(new Date(), 'UTC');
    const from = url.searchParams.get('from') ?? today;
    const to = url.searchParams.get('to') ?? from;
    const duration = Number(url.searchParams.get('duration') ?? '30');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: 'Fechas inválidas' }, { status: 400 });
    }
    if (!Number.isFinite(duration) || duration < 5 || duration > 600) {
      return NextResponse.json({ error: 'Duración inválida' }, { status: 400 });
    }

    const result = await getAvailability(ctx.tenantId, {
      professionalId,
      fromDateKey: from,
      toDateKey: to,
      durationMinutes: duration,
      limit: 120,
    });

    return NextResponse.json({
      timezone: result.timezone,
      reason: result.reason,
      slots: result.slots.map((s) => ({
        dateKey: localDateKey(s.start, result.timezone),
        startMinute: minuteOfDay(s.start, result.timezone),
        startsAt: s.start.toISOString(),
      })),
    });
  } catch (err) {
    if (err instanceof AgendaForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error('[api/agenda/availability]', err);
    return NextResponse.json({ error: 'No se pudo consultar la disponibilidad' }, { status: 500 });
  }
}
