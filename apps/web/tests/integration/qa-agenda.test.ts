// Pruebas de integración del módulo Agenda contra un Postgres REAL.
//
// Cubren lo que no se puede comprobar con dobles: el solapamiento bajo el lock
// por profesional, la idempotencia de las reservas de los agentes, el
// aislamiento por tenant y el recorrido completo "hueco → cita → nota clínica".
//
// Cómo correrlas: ver la cabecera de `vitest.integration.config.ts`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findAgentSlots, getAgentPatientContext, listAgentProfessionals } from '@/lib/agenda/agent';
import type { AgendaContext } from '@/lib/agenda/auth';
import { getAvailability, getPatientDossier, listAgendaPatients } from '@/lib/agenda/queries';
import {
  AgendaValidationError,
  addTimeOff,
  cancelAppointment,
  createAppointment,
  createProfessional,
  replaceShifts,
  saveClinicalNote,
  setProfessionalTreatments,
  updateProfessional,
} from '@/lib/agenda/service';
import { agendaBookAppointment, agendaCheckAvailability } from '@/lib/agenda/voice';
import { dispatchTool } from '@/lib/retell/tools';
import { raw, seedTenant } from './_qa-tasks-helpers';

const TZ = 'Europe/Madrid';

function ctxFor(tenantId: string, userId: string | null = null): AgendaContext {
  return {
    tenantId,
    clerkOrganizationId: 'org_test',
    userId,
    clerkUserId: 'user_test',
    role: 'admin',
    isSuperAdmin: false,
    impersonating: false,
    professional: null,
    scope: 'ALL',
    canManageProfessionals: true,
    canWriteAppointments: true,
    canWriteClinicalNotes: true,
    agendaOnly: false,
  };
}

/** Lunes a viernes, de 9 a 14. */
const HORARIO = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startMinute: 9 * 60,
  endMinute: 14 * 60,
}));

/** Un martes lejano, para que nunca choque con la antelación mínima. */
const MARTES = '2027-03-09';

/**
 * Un día laborable dentro de los 90 días reservables del profesional.
 *
 * Los tests de disponibilidad pueden inyectar `now` y usar fechas fijas; las
 * tools de los agentes no, porque corren con el reloj real. Si se les pide una
 * fecha más allá de `max_advance_days`, la respuesta correcta es "no hay
 * huecos" — así que hay que preguntar por una fecha que la clínica sí acepte.
 */
function diaLaborableCercano(offsetDias = 30): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDias);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function seedTreatment(tenantId: string, name: string, minutes: number): Promise<string> {
  const [row] = await raw<{ id: string }[]>`
    insert into treatments (tenant_id, name, duration_minutes)
    values (${tenantId}, ${name}, ${minutes})
    returning id`;
  return row!.id;
}

let tenantId: string;
let userA: string;
let professionalId: string;
let limpiezaId: string;

beforeAll(async () => {
  const seed = await seedTenant('agenda', TZ);
  tenantId = seed.tenantId;
  userA = seed.userA;

  limpiezaId = await seedTreatment(tenantId, 'Limpieza dental', 30);

  const ctx = ctxFor(tenantId, userA);
  const professional = await createProfessional(ctx, {
    fullName: 'Dra. Marta Ruiz',
    specialty: 'Odontología general',
    agendaEnabled: true,
    minNoticeHours: 0,
    slotGranularityMinutes: 30,
  });
  professionalId = professional!.id;

  await replaceShifts(ctx, professionalId, HORARIO);
  await setProfessionalTreatments(ctx, professionalId, [{ treatmentId: limpiezaId }]);
});

afterAll(async () => {
  await raw.end({ timeout: 5 });
});

describe('disponibilidad', () => {
  it('ofrece los huecos del horario cargado', async () => {
    const result = await getAvailability(tenantId, {
      professionalId,
      fromDateKey: MARTES,
      toDateKey: MARTES,
      durationMinutes: 30,
      now: new Date('2027-03-01T08:00:00Z'),
    });
    expect(result.reason).toBe('OK');
    expect(result.timezone).toBe(TZ);
    expect(result.slots).toHaveLength(10); // 9:00 → 13:30
    expect(result.slots[0]!.start.toISOString()).toBe('2027-03-09T08:00:00.000Z'); // 09:00 Madrid
  });

  it('con la agenda apagada no hay huecos, y al encenderla vuelven', async () => {
    const ctx = ctxFor(tenantId, userA);
    await updateProfessional(ctx, professionalId, { agendaEnabled: false });

    const off = await getAvailability(tenantId, {
      professionalId,
      fromDateKey: MARTES,
      toDateKey: MARTES,
      durationMinutes: 30,
      now: new Date('2027-03-01T08:00:00Z'),
    });
    expect(off.reason).toBe('AGENDA_DISABLED');
    expect(off.slots).toHaveLength(0);

    await updateProfessional(ctx, professionalId, { agendaEnabled: true });
    const on = await getAvailability(tenantId, {
      professionalId,
      fromDateKey: MARTES,
      toDateKey: MARTES,
      durationMinutes: 30,
      now: new Date('2027-03-01T08:00:00Z'),
    });
    expect(on.slots.length).toBeGreaterThan(0);
  });
});

describe('citas', () => {
  it('crea la cita, la deja fuera de los huecos y rechaza el solapamiento', async () => {
    const ctx = ctxFor(tenantId, userA);

    const { appointment } = await createAppointment(ctx, {
      professionalId,
      treatmentId: limpiezaId,
      patientName: 'Ana Pérez',
      patientPhone: '+34600111222',
      startDateKey: MARTES,
      startMinute: 10 * 60,
    });
    expect(appointment.status).toBe('SCHEDULED');
    expect(appointment.patientKey).toBe('tel:+34600111222');
    // La duración sale del tratamiento asignado.
    expect(appointment.endsAt.getTime() - appointment.startsAt.getTime()).toBe(30 * 60_000);

    const after = await getAvailability(tenantId, {
      professionalId,
      fromDateKey: MARTES,
      toDateKey: MARTES,
      durationMinutes: 30,
      now: new Date('2027-03-01T08:00:00Z'),
    });
    expect(after.slots.some((s) => s.start.toISOString() === '2027-03-09T09:00:00.000Z')).toBe(
      false,
    );

    await expect(
      createAppointment(ctx, {
        professionalId,
        patientName: 'Otro Paciente',
        startDateKey: MARTES,
        startMinute: 10 * 60 + 15,
        durationMinutes: 30,
      }),
    ).rejects.toBeInstanceOf(AgendaValidationError);

    // Cancelada, el hueco vuelve a estar libre.
    await cancelAppointment(ctx, appointment.id, 'prueba');
    const freed = await getAvailability(tenantId, {
      professionalId,
      fromDateKey: MARTES,
      toDateKey: MARTES,
      durationMinutes: 30,
      now: new Date('2027-03-01T08:00:00Z'),
    });
    expect(freed.slots.some((s) => s.start.toISOString() === '2027-03-09T09:00:00.000Z')).toBe(
      true,
    );
  });

  it('rechaza lo que cae fuera del horario salvo que se pida expresamente', async () => {
    const ctx = ctxFor(tenantId, userA);

    await expect(
      createAppointment(ctx, {
        professionalId,
        patientName: 'Urgencia Nocturna',
        startDateKey: MARTES,
        startMinute: 22 * 60,
        durationMinutes: 30,
      }),
    ).rejects.toThrow(/fuera del horario/i);

    const { appointment } = await createAppointment(ctx, {
      professionalId,
      patientName: 'Urgencia Nocturna',
      startDateKey: MARTES,
      startMinute: 22 * 60,
      durationMinutes: 30,
      allowOutsideHours: true,
    });
    expect(appointment.id).toBeTruthy();
    await cancelAppointment(ctx, appointment.id);
  });

  it('un bloqueo tapa el hueco y avisa de las citas que quedan dentro', async () => {
    const ctx = ctxFor(tenantId, userA);
    const jueves = '2027-03-11';

    const { appointment } = await createAppointment(ctx, {
      professionalId,
      patientName: 'Paciente Afectado',
      startDateKey: jueves,
      startMinute: 11 * 60,
      durationMinutes: 30,
    });

    const { block, conflictingAppointments } = await addTimeOff(ctx, professionalId, {
      startDateKey: jueves,
      startMinute: 0,
      endDateKey: jueves,
      endMinute: 1440,
      allDay: true,
      kind: 'TIME_OFF',
      reason: 'Congreso',
    });

    // La cita NO se cancela sola: se avisa para que la clínica llame.
    expect(conflictingAppointments).toBe(1);
    expect(block?.id).toBeTruthy();

    const availability = await getAvailability(tenantId, {
      professionalId,
      fromDateKey: jueves,
      toDateKey: jueves,
      durationMinutes: 30,
      now: new Date('2027-03-01T08:00:00Z'),
    });
    expect(availability.slots).toHaveLength(0);

    await cancelAppointment(ctx, appointment.id);
    await raw`delete from professional_time_off where id = ${block!.id}`;
  });
});

describe('agentes virtuales', () => {
  it('ven la agenda, reservan y no duplican al reintentar', async () => {
    const catalog = await listAgentProfessionals(tenantId);
    expect(catalog.map((p) => p.fullName)).toContain('Dra. Marta Ruiz');
    expect(catalog[0]!.treatments.map((t) => t.name)).toContain('Limpieza dental');

    const search = await findAgentSlots(tenantId, {
      treatmentName: 'limpieza',
      preferredDate: '2027-03-16',
      days: 1,
      now: new Date('2027-03-01T08:00:00Z'),
    });
    expect(search.reason).toBe('OK');
    expect(search.matchedTreatment?.name).toBe('Limpieza dental');
    const option = search.options[0]!;
    expect(option.professionalId).toBe(professionalId);

    const first = await agendaBookAppointment(tenantId, {
      start_time: option.start.toISOString(),
      professional_id: option.professionalId,
      treatment_name: 'limpieza',
      patient_name: 'Bruno Díaz',
      phone: '+34600333444',
      dedupe_key: 'call:test-1',
      source: 'VOICE_AGENT',
    });
    expect(first?.result).toMatch(/Cita agendada/);

    // Reintento del webhook con la misma clave: no puede crear otra cita.
    const retry = await agendaBookAppointment(tenantId, {
      start_time: option.start.toISOString(),
      professional_id: option.professionalId,
      treatment_name: 'limpieza',
      patient_name: 'Bruno Díaz',
      phone: '+34600333444',
      dedupe_key: 'call:test-1',
      source: 'VOICE_AGENT',
    });
    expect(retry?.result).toMatch(/ya estaba agendada/);

    const filas = await raw<{ n: number }[]>`
      select count(*)::int as n from agenda_appointments
      where tenant_id = ${tenantId} and patient_key = 'tel:+34600333444'`;
    expect(filas[0]?.n).toBe(1);

    // Y el hueco ya no se ofrece.
    const afterBooking = await agendaCheckAvailability(tenantId, {
      treatment_name: 'limpieza',
      preferred_date: '2027-03-16',
    });
    expect(afterBooking?.result).not.toContain(option.start.toISOString());
  });

  it('le cuentan al agente la próxima cita del paciente, pero no las notas privadas', async () => {
    const ctx = ctxFor(tenantId, userA);
    const contexto = await getAgentPatientContext(tenantId, { phone: '+34600333444' });
    expect(contexto?.nextAppointment?.professionalName).toBe('Dra. Marta Ruiz');

    await saveClinicalNote(ctx, {
      professionalId,
      patientKey: 'tel:+34600333444',
      patientName: 'Bruno Díaz',
      summary: 'Sarro moderado',
      nextSteps: 'Revisión en 6 meses',
    });
    await saveClinicalNote(ctx, {
      professionalId,
      patientKey: 'tel:+34600333444',
      summary: 'Valoración personal',
      nextSteps: 'ESTO NO LO PUEDE LEER UN AGENTE',
      private: true,
    });

    const conNota = await getAgentPatientContext(tenantId, { phone: '+34600333444' });
    expect(conNota?.pendingFollowUp).toBe('Revisión en 6 meses');
  });
});

describe('tools de los agentes virtuales', () => {
  it('dispatchTool entra por la agenda interna, no por GoHighLevel', async () => {
    // Es el mismo punto de entrada que usan el agente de voz, el saliente y el
    // de WhatsApp. La clínica no tiene GHL conectado: si el camino interno no
    // funcionara, la respuesta sería "el CRM no está conectado".
    const profesionales = await dispatchTool(tenantId, 'list_professionals', {});
    expect(profesionales.result).toContain('Dra. Marta Ruiz');
    expect(profesionales.result).toContain('Limpieza dental');

    const dia = diaLaborableCercano();
    const huecos = await dispatchTool(tenantId, 'check_availability', {
      treatment_name: 'limpieza',
      preferred_date: dia,
    });
    expect(huecos.result).toMatch(/Huecos libres/);
    expect(huecos.result).toContain('professional_id=');
    expect(huecos.result).not.toMatch(/CRM no está conectado/);

    const start = /start_time=([^\s\]]+)/.exec(huecos.result)?.[1];
    const prof = /professional_id=([^\s\]]+)/.exec(huecos.result)?.[1];
    expect(start).toBeTruthy();
    expect(prof).toBe(professionalId);

    const reserva = await dispatchTool(tenantId, 'book_appointment', {
      start_time: start,
      professional_id: prof,
      treatment_name: 'limpieza',
      patient_name: 'Carla Voz',
      phone: '+34600555666',
    });
    expect(reserva.result).toMatch(/Cita agendada/);

    // Y el hueco deja de ofrecerse.
    const despues = await dispatchTool(tenantId, 'check_availability', {
      treatment_name: 'limpieza',
      preferred_date: dia,
    });
    expect(despues.result).not.toContain(`start_time=${start}`);
  });

  it('el agente ve la próxima cita del paciente por su teléfono', async () => {
    const info = await dispatchTool(tenantId, 'get_patient_info', { phone: '+34600555666' });
    expect(info.result).toContain('Dra. Marta Ruiz');
    expect(info.result).toMatch(/Tiene cita/);
  });
});

describe('pacientes e historia clínica', () => {
  it('agrupa las citas por paciente y devuelve su ficha', async () => {
    const pacientes = await listAgendaPatients(tenantId, {});
    const bruno = pacientes.find((p) => p.patientKey === 'tel:+34600333444');
    expect(bruno?.patientName).toBe('Bruno Díaz');
    expect(bruno?.noteCount).toBe(2);

    const dossier = await getPatientDossier(tenantId, 'tel:+34600333444');
    expect(dossier?.appointments.length).toBeGreaterThan(0);
    expect(dossier?.notes.length).toBe(2);
  });

  it('la nota tiene que ser de una cita de ese profesional', async () => {
    const ctx = ctxFor(tenantId, userA);
    const otro = await createProfessional(ctx, { fullName: 'Dr. Ajeno', agendaEnabled: true });
    const [cita] = await raw<{ id: string }[]>`
      select id from agenda_appointments
      where tenant_id = ${tenantId} and patient_key = 'tel:+34600333444' limit 1`;

    await expect(
      saveClinicalNote(ctx, {
        professionalId: otro!.id,
        appointmentId: cita!.id,
        patientKey: 'tel:+34600333444',
        summary: 'Nota que no debería poder colgarse aquí',
      }),
    ).rejects.toThrow(/no es de este profesional/i);
  });
});

describe('aislamiento por tenant', () => {
  it('no se puede agendar en el profesional de otra clínica', async () => {
    const otra = await seedTenant('agenda-otra', TZ);
    const ctxOtra = ctxFor(otra.tenantId, otra.userA);

    await expect(
      createAppointment(ctxOtra, {
        professionalId, // el de la primera clínica
        patientName: 'Intruso',
        startDateKey: MARTES,
        startMinute: 12 * 60,
        durationMinutes: 30,
      }),
    ).rejects.toThrow(/no existe/i);

    // Y su agenda no ve nada de la otra.
    const pacientes = await listAgendaPatients(otra.tenantId, {});
    expect(pacientes).toHaveLength(0);
  });

  it('no se puede asignar un tratamiento de otra clínica', async () => {
    const otra = await seedTenant('agenda-otra2', TZ);
    const ctxOtra = ctxFor(otra.tenantId, otra.userA);
    const suyo = await createProfessional(ctxOtra, { fullName: 'Dra. Vecina' });

    const result = await setProfessionalTreatments(ctxOtra, suyo!.id, [
      { treatmentId: limpiezaId }, // tratamiento de la primera clínica
    ]);
    expect(result.count).toBe(0);

    const filas = await raw<{ n: number }[]>`
      select count(*)::int as n from professional_treatments
      where professional_id = ${suyo!.id}`;
    expect(filas[0]?.n).toBe(0);
  });
});
