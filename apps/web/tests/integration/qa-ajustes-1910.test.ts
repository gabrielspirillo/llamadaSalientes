// Ajustes de Respinens del 19/10, contra un Postgres REAL. Cómo correrlas: ver
// la cabecera de `vitest.integration.config.ts`.

import { beforeAll, describe, expect, it } from 'vitest';

import type { AgendaContext } from '@/lib/agenda/auth';
import {
  markAppointmentUnpaid,
  paymentsForAppointments,
  registerPayment,
} from '@/lib/agenda/charges';
import { getAvailability, listAgendaPatients, listAppointmentsInRange } from '@/lib/agenda/queries';
import {
  createAppointment,
  createProfessional,
  replaceShifts,
  setAdvancePreference,
} from '@/lib/agenda/service';
import { inactivePatients } from '@/lib/agenda/sweeps';
import { createPatient, getPatientPerson, updatePatient } from '@/lib/patients/persons';
import { raw, seedTenant } from './_qa-tasks-helpers';

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

const DIA = '2027-03-09'; // martes lejano

let tenantId: string;
let userA: string;
let professionalId: string;

beforeAll(async () => {
  const seed = await seedTenant('ajustes1910');
  tenantId = seed.tenantId;
  userA = seed.userA;
  const pro = await createProfessional(ctxFor(tenantId, userA), {
    fullName: 'Raquel',
    agendaEnabled: true,
  });
  professionalId = pro!.id;
  await replaceShifts(
    ctxFor(tenantId, userA),
    professionalId,
    [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 16 * 60, endMinute: 20 * 60 + 30 })),
  );
  await raw`insert into tenant_care_profile (tenant_id, profile, booking_policy)
    values (${tenantId}, 'PEDIATRIC', '{"visibleStatuses":["SCHEDULED","CONFIRMED","NO_SHOW"]}')`;
});

describe('19/10', () => {
  it('el listado de pacientes busca sin tildes ni mayúsculas', async () => {
    const scope = { tenantId, userId: userA };
    await createPatient(scope, {
      firstName: 'Álvaro',
      lastName: 'Peña Díaz',
      contactPhone: '+34611000111',
    });
    for (const q of ['alvaro', 'ALVARO', 'pena', 'peña', 'DIAZ']) {
      const rows = await listAgendaPatients(tenantId, { search: q });
      expect(
        rows.map((r) => r.patientName),
        q,
      ).toContain('Álvaro Peña Díaz');
    }
  });

  it('el nombre corregido en la ficha se ve en la agenda', async () => {
    const scope = { tenantId, userId: userA };
    const p = await createPatient(scope, {
      firstName: 'Hugo',
      lastName: 'Gonzalez Amiga Dayana',
      contactPhone: '+34611000222',
    });
    await createAppointment(ctxFor(tenantId, userA), {
      professionalId,
      patientId: p.id,
      patientName: p.fullName,
      startDateKey: DIA,
      startMinute: 16 * 60,
      durationMinutes: 30,
    });
    const person = await getPatientPerson(tenantId, p.id);
    await updatePatient(scope, p.id, {
      firstName: 'Hugo',
      lastName: 'González Cervantes',
      birthDate: person?.birthDate ?? '',
      notes: '',
    });
    const appts = await listAppointmentsInRange(tenantId, {
      from: new Date(`${DIA}T00:00:00Z`),
      to: new Date(`${DIA}T23:59:59Z`),
    });
    expect(appts.find((a) => a.patientId === p.id)?.patientName).toBe('Hugo González Cervantes');
    const [stored] =
      await raw`select patient_name from agenda_appointments where patient_id = ${p.id}`;
    expect(stored!.patient_name).toBe('Hugo González Cervantes');
  });

  it('al mover una cita, su propio hueco sale libre', async () => {
    const { appointment } = await createAppointment(ctxFor(tenantId, userA), {
      professionalId,
      patientName: 'Mover Prueba',
      startDateKey: DIA,
      startMinute: 17 * 60,
      durationMinutes: 30,
    });
    const now = new Date('2027-01-01T00:00:00Z');
    const base = { professionalId, fromDateKey: DIA, toDateKey: DIA, durationMinutes: 30, now };
    const without = await getAvailability(tenantId, base);
    const withExclude = await getAvailability(tenantId, {
      ...base,
      excludeAppointmentId: appointment.id,
    });
    const at17 = (r: typeof without) =>
      r.slots.some((s) => s.start.toISOString() === appointment.startsAt.toISOString());
    expect(at17(without)).toBe(false);
    expect(at17(withExclude)).toBe(true);
  });

  it('adelantar, pagar y "no pagado" desde la cita', async () => {
    const ctx = ctxFor(tenantId, userA);
    const { appointment } = await createAppointment(ctx, {
      professionalId,
      patientName: 'Pago Prueba',
      startDateKey: DIA,
      startMinute: 18 * 60,
      durationMinutes: 30,
      advancePreference: 'ACCEPTS',
      advanceNote: 'desde las 18h',
    });
    expect(appointment.advancePreference).toBe('ACCEPTS');
    await setAdvancePreference(ctx, appointment.id, { preference: 'NO_MOVE' });
    const [row] =
      await raw`select advance_preference, advance_note from agenda_appointments where id = ${appointment.id}`;
    expect(row).toMatchObject({ advance_preference: 'NO_MOVE', advance_note: null });

    const scope = { tenantId, userId: userA };
    await registerPayment(scope, {
      appointmentId: appointment.id,
      amountCents: 4500,
      paidOn: DIA,
      paymentMethod: 'CARD',
    });
    let pay = (await paymentsForAppointments(tenantId, [appointment.id])).get(appointment.id);
    expect(pay).toMatchObject({ paid: true, method: 'CARD', amountCents: 4500 });
    await markAppointmentUnpaid(scope, appointment.id);
    pay = (await paymentsForAppointments(tenantId, [appointment.id])).get(appointment.id);
    expect(pay).toMatchObject({ paid: false, method: null });
  });

  it('sin "Atendida", el barrido de inactivos cuenta las citas pasadas no anuladas', async () => {
    await raw`insert into agenda_appointments (tenant_id, professional_id, patient_key, patient_name, starts_at, ends_at, status)
      values (${tenantId}, ${professionalId}, 'tel:+34611000999', 'Inactivo', now() - interval '400 days', now() - interval '400 days' + interval '30 minutes', 'SCHEDULED')`;
    const rows = await inactivePatients(tenantId, new Date(Date.now() - 180 * 86_400_000));
    expect(rows.map((r) => r.patientKey)).toContain('tel:+34611000999');
  });
});
