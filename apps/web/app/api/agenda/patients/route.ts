import { NextResponse } from 'next/server';

import { requireAgendaWriter } from '@/lib/agenda/auth';
import { describeAge } from '@/lib/care-profile/policy';
import { listPatientPersons, listPatientsForPhone } from '@/lib/patients/persons';
import { localDateKey } from '@/lib/tasks/tz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Buscador de pacientes del alta de cita. Antes la página mandaba los 300
 * primeros por apellido y el navegador filtraba: a partir del 300 nadie
 * aparecía y recepción volvía a darlos de alta.
 *
 * `?q=` busca por nombre, tutor o teléfono (sin tildes); `?phone=` devuelve
 * los niños que cuelgan de ese teléfono. El tenant sale de la sesión.
 */
export async function GET(req: Request) {
  let ctx: Awaited<ReturnType<typeof requireAgendaWriter>>;
  try {
    ctx = await requireAgendaWriter();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
  const phone = (url.searchParams.get('phone') ?? '').trim().slice(0, 30);

  const found = phone
    ? await listPatientsForPhone(ctx.tenantId, phone)
    : q.length >= 2
      ? await listPatientPersons(ctx.tenantId, { search: q, limit: 20 })
      : [];

  const todayKey = localDateKey(new Date(), 'UTC');
  return NextResponse.json({
    patients: found.map((p) => {
      const age = p.birthDate ? describeAge(p.birthDate, todayKey) : null;
      return {
        id: p.id,
        label: age ? `${p.fullName} · ${age}` : p.fullName,
        name: p.fullName,
        phone: p.contactPhone,
        tutor: p.contactName,
      };
    }),
  });
}
