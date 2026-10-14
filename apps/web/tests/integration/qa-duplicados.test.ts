// Contactos y fichas sin duplicar, y una nota por visita, contra un Postgres
// REAL. Cómo correrlas: ver la cabecera de `vitest.integration.config.ts`.

import { beforeAll, describe, expect, it } from 'vitest';

import type { AgendaContext } from '@/lib/agenda/auth';
import { listAgendaPatients } from '@/lib/agenda/queries';
import {
  createAppointment,
  createProfessional,
  replaceShifts,
  saveClinicalNote,
} from '@/lib/agenda/service';
import {
  DuplicatePatientError,
  createPatient,
  listPatientsForPhone,
  mergePatients,
} from '@/lib/patients/persons';
import { upsertPatientRecord } from '@/lib/patients/registry';
import { upsertWhatsappContact } from '@/lib/whatsapp/persist';
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

let tenantId: string;
let userA: string;
let professionalId: string;

beforeAll(async () => {
  const seed = await seedTenant('duplicados');
  tenantId = seed.tenantId;
  userA = seed.userA;
  const professional = await createProfessional(ctxFor(tenantId, userA), {
    fullName: 'Dra. Ana Gil',
    agendaEnabled: true,
  });
  professionalId = professional!.id;
  await replaceShifts(
    ctxFor(tenantId, userA),
    professionalId,
    [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 9 * 60, endMinute: 14 * 60 })),
  );
});

describe('contactos sin duplicar', () => {
  it('el WhatsApp con prefijo cae en el contacto guardado sin él y lo corrige', async () => {
    // Un contacto viejo guardado sin el +34 (como lo dejaba el panel antes).
    await raw`insert into whatsapp_contacts (tenant_id, phone_e164, name)
      values (${tenantId}, '+611222333', 'Laura')`;
    const contact = await upsertWhatsappContact({
      tenantId,
      phoneE164: '+34611222333',
      name: 'Laura WA',
    });
    expect(contact.phoneE164).toBe('+34611222333');
    expect(contact.name).toBe('Laura');
    const rows = await raw`select id from whatsapp_contacts
      where tenant_id = ${tenantId} and phone_e164 like '%611222333'`;
    expect(rows).toHaveLength(1);
  });

  it('el panel sin prefijo reutiliza el contacto de WhatsApp', async () => {
    const wa = await upsertWhatsappContact({ tenantId, phoneE164: '+34622333444', name: 'Pedro' });
    const panel = await upsertPatientRecord({ tenantId, phone: '622 333 444', fullName: 'Pedro' });
    expect(panel?.id).toBe(wa.id);
  });

  it('los hijos se encuentran también por el móvil del otro tutor', async () => {
    const scope = { tenantId, userId: userA };
    const nino = await createPatient(scope, {
      firstName: 'Mateo',
      lastName: 'López',
      birthDate: '2025-01-10',
      contactPhone: '+34633444555',
      guardians: [
        { role: 'MADRE', name: 'Eva', phone: '+34633444555', primary: true },
        { role: 'PADRE', name: 'Iván', phone: '644 555 666' },
      ],
    });
    const delPadre = await listPatientsForPhone(tenantId, '+34644555666');
    expect(delPadre.map((p) => p.id)).toEqual([nino.id]);

    // El padre escribe: no sale como paciente nuevo en la lista.
    await upsertWhatsappContact({ tenantId, phoneE164: '+34644555666', name: 'Iván' });
    const lista = await listAgendaPatients(tenantId);
    expect(lista.some((p) => p.patientPhone === '+34644555666')).toBe(false);
  });

  it('no deja crear otra ficha del mismo niño', async () => {
    const scope = { tenantId, userId: userA };
    await createPatient(scope, {
      firstName: 'Lucía',
      lastName: 'Pérez',
      birthDate: '2024-05-01',
      contactPhone: '+34655666777',
    });
    await expect(
      createPatient(scope, {
        firstName: 'lucia',
        lastName: 'PEREZ',
        birthDate: '2024-05-01',
        contactPhone: '655666777',
      }),
    ).rejects.toBeInstanceOf(DuplicatePatientError);
  });

  it('une dos fichas con su historia en la que se queda', async () => {
    const scope = { tenantId, userId: userA };
    const a = await createPatient(scope, { firstName: 'Hugo', contactPhone: '+34666777888' });
    const [b] = await raw<{ id: string }[]>`insert into patients (tenant_id, first_name, birth_date)
      values (${tenantId}, 'Hugo', '2024-02-02') returning id`;
    await saveClinicalNote(ctxFor(tenantId, userA), {
      professionalId,
      patientKey: `pat:${b!.id}`,
      summary: 'Bronquiolitis',
    });
    const { moved } = await mergePatients(scope, a.id, [`pat:${b!.id}`]);
    expect(moved).toBe(1);
    const [kept] = await raw`select birth_date::text from patients where id = ${a.id}`;
    expect(kept!.birth_date).toBe('2024-02-02');
    const gone = await raw`select id from patients where id = ${b!.id}`;
    expect(gone).toHaveLength(0);
    const notes =
      await raw`select patient_id from clinical_notes where patient_key = ${`pat:${a.id}`}`;
    expect(notes).toHaveLength(1);
  });
});

describe('una nota por visita', () => {
  it('guardar dos veces el mismo día deja una sola nota', async () => {
    const ctx = ctxFor(tenantId, userA);
    const key = 'tel:+34677888999';
    const first = await saveClinicalNote(ctx, {
      professionalId,
      patientKey: key,
      summary: 'Tos',
      symptoms: 'Fiebre',
    });
    const second = await saveClinicalNote(ctx, {
      professionalId,
      patientKey: key,
      summary: 'Tos y mocos',
      observations: 'Mejor',
    });
    expect(second?.id).toBe(first?.id);
    expect(second?.symptoms).toBe('Fiebre');
    expect(second?.observations).toBe('Mejor');
    const rows =
      await raw`select id from clinical_notes where tenant_id = ${tenantId} and patient_key = ${key}`;
    expect(rows).toHaveLength(1);
  });

  it('la nota de una cita se completa aunque se guarde otra vez', async () => {
    const ctx = ctxFor(tenantId, userA);
    const { appointment: appt } = await createAppointment(ctx, {
      professionalId,
      patientName: 'Sara',
      patientPhone: '+34688999000',
      startDateKey: '2027-03-09',
      startMinute: 10 * 60,
      durationMinutes: 30,
    });
    const n1 = await saveClinicalNote(ctx, {
      professionalId,
      appointmentId: appt.id,
      patientKey: appt.patientKey,
      summary: 'Primera',
    });
    const n2 = await saveClinicalNote(ctx, {
      professionalId,
      appointmentId: appt.id,
      patientKey: appt.patientKey,
      summary: 'Primera, corregida',
    });
    expect(n2?.id).toBe(n1?.id);
  });
});
