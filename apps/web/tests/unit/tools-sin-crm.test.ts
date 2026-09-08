import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * Las herramientas de los agentes con la clínica SIN CRM conectado.
 *
 * Es el caso que estaba roto: `register_patient` iba directa a GoHighLevel y,
 * sin él, respondía "el CRM no está conectado". El agente lo leía como
 * herramienta fallida y, por la regla de honestidad del prompt, derivaba a
 * recepción — con lo que una clínica que lleva su agenda en la plataforma no
 * podía dar cita a un paciente nuevo.
 *
 * Se prueban las decisiones, no el SQL: la libreta de pacientes y el puente con
 * la agenda se falsean.
 */

const state = vi.hoisted(() => ({
  /** Libreta de pacientes en memoria, indexada por teléfono. */
  libreta: new Map<string, Record<string, unknown>>(),
  /** Qué devuelve la agenda de la plataforma. `null` = la clínica no la usa. */
  agendaReserva: null as { result: string } | null,
  reservasRecibidas: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/data/ghl-integration', () => ({
  getGhlIntegration: vi.fn(async () => null),
}));

vi.mock('@/lib/agenda/voice', () => ({
  agendaCheckAvailability: vi.fn(async () => null),
  agendaCancelAppointment: vi.fn(async () => null),
  agendaListProfessionals: vi.fn(async () => null),
  agendaPatientSummary: vi.fn(async () => null),
  agendaBookAppointment: vi.fn(async (_tenantId: string, args: Record<string, unknown>) => {
    state.reservasRecibidas.push(args);
    return state.agendaReserva;
  }),
}));

vi.mock('@/lib/patients/registry', () => ({
  findPatientByPhone: vi.fn(async (_t: string, phone: string) => state.libreta.get(phone) ?? null),
  upsertPatientRecord: vi.fn(async (input: Record<string, unknown>) => {
    const phone = input.phone as string | null;
    if (!phone) return null;
    const prev = state.libreta.get(phone) ?? { phoneE164: phone };
    const row = { ...prev, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v)) };
    state.libreta.set(phone, row);
    return row;
  }),
  setPatientEmail: vi.fn(async (_t: string, phone: string, email: string) => {
    const row = { ...(state.libreta.get(phone) ?? { phoneE164: phone }), email };
    state.libreta.set(phone, row);
    return row;
  }),
  describePatient: (r: Record<string, unknown>) =>
    [r.firstName, r.lastName].filter(Boolean).join(' ') || 'Sin nombre',
}));

vi.mock('@/lib/data/calls', () => ({
  patchCallCustomData: vi.fn(),
  setCallGhlContact: vi.fn(),
}));

vi.mock('@/lib/ghl/client', () => ({
  ghlFetch: vi.fn(),
  GhlApiError: class extends Error {},
}));
vi.mock('@/lib/ghl/calendars', () => ({ resolveCalendarId: vi.fn(), getFreeSlots: vi.fn() }));
vi.mock('@/lib/ghl/contacts-mutations', () => ({
  lookupContactByPhone: vi.fn(),
  createContact: vi.fn(),
  updateContact: vi.fn(),
}));
vi.mock('@/lib/appointments/cache', () => ({ upsertAppointmentCache: vi.fn() }));
vi.mock('@/lib/data/faqs', () => ({ listFaqsForTenant: vi.fn(async () => []) }));
vi.mock('@/lib/data/treatments', () => ({ listTreatmentsForTenant: vi.fn(async () => []) }));
vi.mock('@/lib/openai/client', () => ({ embedText: vi.fn() }));

import { bookAppointment, getPatientInfo, registerPatient, setLeadEmail } from '@/lib/retell/tools';

const TENANT = 'tenant-1';
const TEL = '+34600111222';

beforeEach(() => {
  state.libreta.clear();
  state.agendaReserva = { result: 'Cita agendada: 2026-09-20 10:00 con Dra. Ruiz.' };
  state.reservasRecibidas = [];
});

describe('register_patient sin CRM', () => {
  it('da de alta al paciente y dice que se puede reservar sin contact_id', async () => {
    const res = await registerPatient(TENANT, {
      first_name: 'Adrián',
      last_name: 'Ortiz',
      phone: TEL,
    });

    expect(res.result).toContain('Adrián Ortiz');
    expect(res.result).toContain('No hace falta contact_id');
    // Lo importante: no vuelve a hablar del CRM ni pide derivar a recepción.
    expect(res.result).not.toContain('CRM no está conectado');
    expect(state.libreta.get(TEL)).toMatchObject({ firstName: 'Adrián', lastName: 'Ortiz' });
  });

  it('usa el teléfono que sabe el canal cuando el modelo no lo pasa', async () => {
    // El LLM omite el teléfono la mitad de las veces; el canal siempre lo sabe.
    const res = await registerPatient(
      TENANT,
      { first_name: 'Marta', phone: '' },
      { patientPhone: TEL },
    );

    expect(res.result).toContain('Marta');
    expect(state.libreta.has(TEL)).toBe(true);
  });

  it('pide el teléfono cuando no hay ninguno por ningún lado', async () => {
    const res = await registerPatient(TENANT, { first_name: 'Marta', phone: 'no-es-un-numero' });
    expect(res.result).toContain('formato internacional');
    expect(state.libreta.size).toBe(0);
  });

  it('sin nombre no registra nada', async () => {
    const res = await registerPatient(TENANT, { first_name: '  ', phone: TEL });
    expect(res.result).toContain('necesito al menos su nombre');
    expect(state.libreta.size).toBe(0);
  });
});

describe('get_patient_info sin CRM', () => {
  it('reconoce a un paciente de la libreta y recuerda que no hace falta contact_id', async () => {
    state.libreta.set(TEL, { phoneE164: TEL, firstName: 'Adrián', lastName: 'Ortiz' });

    const res = await getPatientInfo(TENANT, { phone: TEL });

    expect(res.result).toContain('Adrián Ortiz');
    expect(res.result).toContain('NO hace falta contact_id');
    expect(res.result).not.toContain('CRM no está conectado');
  });

  it('a quien no conoce lo trata como paciente nuevo, no como error', async () => {
    const res = await getPatientInfo(TENANT, { phone: TEL });
    expect(res.result).toContain('paciente nuevo');
    expect(res.result).toContain('register_patient');
  });
});

describe('set_lead_email sin CRM', () => {
  it('guarda el correo en la ficha en vez de perderlo', async () => {
    const res = await setLeadEmail(TENANT, { email: 'a@b.com', phone: TEL });
    expect(res.result).toContain('guardado en la ficha');
    expect(state.libreta.get(TEL)).toMatchObject({ email: 'a@b.com' });
  });

  it('sin teléfono no sabe en qué ficha guardarlo y lo dice', async () => {
    const res = await setLeadEmail(TENANT, { email: 'a@b.com' });
    expect(res.result).toContain('teléfono');
    expect(state.libreta.size).toBe(0);
  });
});

describe('book_appointment con la agenda de la plataforma', () => {
  it('completa el teléfono desde el canal y ficha al paciente', async () => {
    const res = await bookAppointment(
      TENANT,
      {
        start_time: '2026-09-20T10:00:00.000Z',
        treatment_name: 'Limpieza',
        patient_name: 'Adrián Ortiz',
        professional_id: 'prof-1',
      },
      { patientPhone: TEL, channel: 'VOICE' },
    );

    expect(res.result).toContain('Cita agendada');
    expect(state.reservasRecibidas[0]).toMatchObject({ phone: TEL, patient_name: 'Adrián Ortiz' });
    // La cita queda, y el paciente entra en la libreta de la clínica.
    expect(state.libreta.get(TEL)).toBeTruthy();
  });

  it('coge el nombre de la ficha cuando el modelo no lo pasa', async () => {
    // Rechazar la reserva por falta de nombre era peor que usar el guardado, y
    // dejar que el modelo se lo invente, peor todavía.
    state.libreta.set(TEL, { phoneE164: TEL, firstName: 'Adrián', lastName: 'Ortiz' });

    await bookAppointment(
      TENANT,
      { start_time: '2026-09-20T10:00:00.000Z', treatment_name: 'Limpieza' },
      { patientPhone: TEL },
    );

    expect(state.reservasRecibidas[0]).toMatchObject({ patient_name: 'Adrián Ortiz' });
  });

  it('no cuela como id de CRM lo que el modelo se invente', async () => {
    await bookAppointment(
      TENANT,
      {
        start_time: '2026-09-20T10:00:00.000Z',
        treatment_name: 'Limpieza',
        patient_name: 'Marta',
        contact_id: 'Gabriel/+5491133334444',
      },
      { patientPhone: TEL },
    );

    // Un id inventado guardado como id del CRM parte la identidad del paciente.
    expect(state.reservasRecibidas[0]?.contact_id).toBeUndefined();
  });

  it('sin agenda propia ni CRM, dice qué hacer', async () => {
    state.agendaReserva = null;

    const res = await bookAppointment(
      TENANT,
      { start_time: '2026-09-20T10:00:00.000Z', treatment_name: 'Limpieza', patient_name: 'Marta' },
      { patientPhone: TEL },
    );

    expect(res.result).toContain('no tiene su agenda configurada');
    expect(res.result).toContain('recepción');
  });
});
