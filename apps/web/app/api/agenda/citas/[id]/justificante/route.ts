import { type NextRequest, NextResponse } from 'next/server';

import { isUuid } from '@/lib/agenda/appointment-ref';
import { AttendanceError, getAttendancePdf } from '@/lib/agenda/attendance';
import { assertProfessionalInScope, getAgendaContext } from '@/lib/agenda/auth';
import { getAppointment } from '@/lib/agenda/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Justificante de asistencia de una cita, generado al pedirlo. `?download=1` lo baja. */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let agenda: Awaited<ReturnType<typeof getAgendaContext>>;
  try {
    agenda = await getAgendaContext();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const appt = await getAppointment(agenda.tenantId, id);
  if (!appt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  try {
    await assertProfessionalInScope(agenda, appt.professionalId);
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  let pdf: Awaited<ReturnType<typeof getAttendancePdf>>;
  try {
    pdf = await getAttendancePdf(agenda.tenantId, id);
  } catch (err) {
    if (err instanceof AttendanceError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error('[justificante] no se pudo generar', { id, err: (err as Error).message });
    return NextResponse.json({ error: 'No se pudo generar el justificante.' }, { status: 500 });
  }
  if (!pdf) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const disposition = req.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline';
  return new NextResponse(Buffer.from(pdf.bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${pdf.fileName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
