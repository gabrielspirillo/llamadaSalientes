// Consentimientos (con Documenso simulado) y etiquetas de mellizos, gemelos y
// hermanos, contra un Postgres REAL. Cómo correrlas: ver la cabecera de
// `vitest.integration.config.ts`.
//
// Nació de dos incidencias de Respinens (22/10): tres familias recibieron el
// consentimiento de OTRO niño, y unos mellizos salían como "1ª visita".

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AgendaContext } from '@/lib/agenda/auth';
import {
  AgendaPolicyError,
  createAppointment,
  createProfessional,
  replaceShifts,
} from '@/lib/agenda/service';
import {
  type FamilyPatient,
  appointmentTypeTag,
  familyTagFor,
  groupFamilies,
} from '@/lib/care-profile/siblings';
import { ConsentError, completeConsent, refreshConsent, sendConsent } from '@/lib/consents/service';
import { encrypt } from '@/lib/crypto';
import { createPatient, listFamilyPatients } from '@/lib/patients/persons';
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
let tGemelos: string;
let tPrimera: string;
let tHermanos: string;

beforeAll(async () => {
  const seed = await seedTenant('consentimientos');
  tenantId = seed.tenantId;
  userA = seed.userA;
  await raw`update clinic_settings set timezone = 'Europe/Madrid' where tenant_id = ${tenantId}`;
  await raw`insert into tenant_care_profile (tenant_id, profile, booking_policy)
    values (${tenantId}, 'PEDIATRIC', '{"maxConsecutiveFirstVisits":2,"visibleStatuses":["SCHEDULED","CONFIRMED","NO_SHOW"]}')`;
  const pro = await createProfessional(ctxFor(tenantId, userA), {
    fullName: 'Raquel',
    agendaEnabled: true,
  });
  professionalId = pro!.id;
  await replaceShifts(
    ctxFor(tenantId, userA),
    professionalId,
    [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 15 * 60, endMinute: 20 * 60 + 30 })),
  );
  const [g] = await raw<{ id: string }[]>`insert into treatments (tenant_id, name, duration_minutes)
    values (${tenantId}, 'GEMELOS / MELLIZOS', 30) returning id`;
  const [p] = await raw<{ id: string }[]>`insert into treatments (tenant_id, name, duration_minutes)
    values (${tenantId}, 'PRIMERA VISITA', 30) returning id`;
  const [h] = await raw<{ id: string }[]>`insert into treatments (tenant_id, name, duration_minutes)
    values (${tenantId}, 'PRIMERA VISITA HERMANOS', 30) returning id`;
  tGemelos = g!.id;
  tPrimera = p!.id;
  tHermanos = h!.id;
  // Las migraciones de producción que marcan los tratamientos por nombre.
  for (const file of [
    '0045_primera_visita_por_tratamiento.sql',
    '0050_gemelos_no_primera_visita.sql',
  ]) {
    await raw.unsafe(
      readFileSync(path.resolve(__dirname, '../../../../supabase/migrations', file), 'utf8'),
    );
  }

  await raw`insert into esign_integrations (tenant_id, provider, base_url, api_token_enc, webhook_secret_enc, active)
    values (${tenantId}, 'DOCUMENSO', 'https://firma.test', ${encrypt('token-de-prueba-123')}, ${encrypt('secreto-del-webhook-123')}, true)`;
  await raw`insert into consent_templates (tenant_id, key, title, body, acknowledgments, message_template)
    values (${tenantId}, 'CONSENTIMIENTO_MENOR', 'Consentimiento informado',
      '[{"type":"heading","text":"Consentimiento"},{"type":"paragraph","text":"Texto del consentimiento."}]',
      '["He leído el documento"]', 'Hola {{tutor}}, firma el de {{paciente}}: {{enlace}}')`;
});

// ─── Documenso simulado ──────────────────────────────────────────────────────

interface FakeDoc {
  id: number;
  envelopeId: string;
  externalId: string;
  title: string;
  email: string;
  token: string;
}

/**
 * Se comporta como la instancia real: guarda lo que se crea y lo devuelve por
 * id y por sobre. `lie` hace que el GET devuelva OTRO documento (el bug).
 */
function fakeDocumenso(opts: { lie?: 'other-doc' } = {}) {
  const docs: FakeDoc[] = [
    // Un documento viejo de otra familia, ya en la instancia.
    {
      id: 1,
      envelopeId: 'envelope_old',
      externalId: '00000000-0000-0000-0000-000000000000',
      title: 'Consentimiento informado — Oliver Velasco López',
      email: 'tutor.34667345224@sin-correo.invalid',
      token: 'tok-oliver',
    },
  ];
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    calls.push(`${init.method ?? 'GET'} ${u.pathname}`);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (u.pathname === '/api/v2/document/create') {
      const payload = JSON.parse(String((init.body as FormData).get('payload')));
      const doc: FakeDoc = {
        id: docs.length + 1,
        envelopeId: `envelope_${docs.length + 1}`,
        externalId: payload.externalId,
        title: payload.title,
        email: payload.recipients[0].email,
        token: `tok-${docs.length + 1}`,
      };
      docs.push(doc);
      return json(200, { id: doc.id, envelopeId: doc.envelopeId });
    }
    const show = (d: FakeDoc | undefined) =>
      d
        ? json(200, {
            id: d.id,
            secondaryId: `document_${d.id}`,
            externalId: d.externalId,
            title: d.title,
            status: 'PENDING',
            recipients: [{ role: 'SIGNER', email: d.email, token: d.token }],
          })
        : json(404, { message: 'not found' });
    const env = /^\/api\/v2\/envelope\/(.+)$/.exec(u.pathname);
    if (env) {
      return show(opts.lie ? docs[0] : docs.find((d) => d.envelopeId === env[1]));
    }
    const byId = /^\/api\/v2\/document\/(\d+)$/.exec(u.pathname);
    if (byId) return show(opts.lie ? docs[0] : docs.find((d) => d.id === Number(byId[1])));
    if (u.pathname === '/api/v2/document/distribute') return json(200, { success: true });
    if (/\/download/.test(u.pathname)) return new Response('%PDF-1.4 firmado', { status: 200 });
    return json(404, { message: 'not found' });
  });
  return { docs, calls };
}

afterEach(() => vi.unstubAllGlobals());

async function kid(firstName: string, lastName: string, phone: string, birthDate: string) {
  return createPatient(
    { tenantId, userId: userA },
    { firstName, lastName, birthDate, contactPhone: phone },
  );
}

const guardian = (name: string, phone: string) => ({
  name,
  phone,
  email: '',
  dni: '',
  address: '',
});

// ─── Consentimientos ─────────────────────────────────────────────────────────

describe('consentimientos', () => {
  it('cada consentimiento lleva SU niño y SU enlace, también entre hermanos', async () => {
    const { docs } = fakeDocumenso();
    const adrian = await kid('Adrián', 'Viera Gómez', '+34611200001', '2025-03-01');
    const irene = await kid('Irene', 'Muela Sanz', '+34611200002', '2024-11-12');
    // Hermana de Adrián: mismo tutor y mismo móvil.
    const lucia = await kid('Lucía', 'Viera Gómez', '+34611200001', '2023-05-20');

    const rA = await sendConsent({
      tenantId,
      patientId: adrian.id,
      guardian: guardian('Marta Gómez', '+34611200001'),
      sentByUserId: userA,
      connector: null,
    });
    const rI = await sendConsent({
      tenantId,
      patientId: irene.id,
      guardian: guardian('Ana Sanz', '+34611200002'),
      sentByUserId: userA,
      connector: null,
    });
    const rL = await sendConsent({
      tenantId,
      patientId: lucia.id,
      guardian: guardian('Marta Gómez', '+34611200001'),
      sentByUserId: userA,
      connector: null,
    });

    for (const [result, name] of [
      [rA, 'Adrián Viera Gómez'],
      [rI, 'Irene Muela Sanz'],
      [rL, 'Lucía Viera Gómez'],
    ] as const) {
      const doc = docs.find((d) => d.externalId === result.consentId);
      expect(doc?.title, name).toContain(name);
      expect(result.signingUrl).toBe(`https://firma.test/sign/${doc?.token}`);
      expect(result.signingUrl).not.toContain('tok-oliver');
    }
    // Los dos hermanos comparten tutor pero no documento ni enlace.
    expect(rA.signingUrl).not.toBe(rL.signingUrl);

    const rows = await raw<
      { patient_id: string; provider_document_id: number; signing_url: string }[]
    >`
      select patient_id, provider_document_id, signing_url from patient_consents where id = ${rA.consentId}`;
    expect(rows[0]?.patient_id).toBe(adrian.id);
    expect(rows[0]?.signing_url).toBe(rA.signingUrl);
  });

  it('si Documenso devuelve el documento de otro niño, no se manda NADA', async () => {
    fakeDocumenso({ lie: 'other-doc' });
    const p = await kid('Pablo', 'Ríos Lara', '+34611200003', '2025-01-15');
    await expect(
      sendConsent({
        tenantId,
        patientId: p.id,
        guardian: guardian('Eva Lara', '+34611200003'),
        sentByUserId: userA,
        connector: null,
      }),
    ).rejects.toBeInstanceOf(ConsentError);
    const rows = await raw`select id from patient_consents where patient_id = ${p.id}`;
    expect(rows).toHaveLength(0);
  });

  it('"Comprobar firma" rechaza un documento ajeno guardado antes del arreglo', async () => {
    fakeDocumenso();
    const p = await kid('Noa', 'Pardo Gil', '+34611200004', '2025-02-02');
    // Fila vieja que apunta al documento de Oliver (lo que dejó el bug).
    const [row] = await raw<{ id: string }[]>`
      insert into patient_consents (tenant_id, patient_id, template_key, provider, provider_document_id, recipient_name, recipient_phone, signing_url, status, sent_at)
      values (${tenantId}, ${p.id}, 'CONSENTIMIENTO_MENOR', 'DOCUMENSO', 1, 'Tutor', '+34611200004', 'https://firma.test/sign/tok-oliver', 'SENT', now())
      returning id`;
    await expect(refreshConsent({ tenantId, consentId: row!.id })).rejects.toBeInstanceOf(
      ConsentError,
    );
    const [after] = await raw<{ status: string; error: string | null }[]>`
      select status, error from patient_consents where id = ${row!.id}`;
    expect(after?.status).toBe('SENT');
    expect(after?.error).toMatch(/no correspond/);
  });

  it('al firmar, el PDF se baja del documento que manda el webhook, no del guardado', async () => {
    const { calls } = fakeDocumenso();
    const p = await kid('Leo', 'Mora Paz', '+34611200005', '2025-04-04');
    const [row] = await raw<{ id: string }[]>`
      insert into patient_consents (tenant_id, patient_id, template_key, provider, provider_document_id, recipient_name, recipient_phone, signing_url, status, sent_at)
      values (${tenantId}, ${p.id}, 'CONSENTIMIENTO_MENOR', 'DOCUMENSO', 555, 'Tutor', '+34611200005', 'x', 'SENT', now())
      returning id`;
    await completeConsent({
      tenantId,
      providerDocumentId: 77,
      externalId: row!.id,
      completedAt: new Date(),
    });
    const downloads = calls.filter((c) => c.includes('/download'));
    expect(downloads.length).toBeGreaterThan(0);
    expect(downloads.every((c) => c.includes('/77/'))).toBe(true);
    const [after] = await raw<
      { status: string }[]
    >`select status from patient_consents where id = ${row!.id}`;
    expect(after?.status).toBe('SIGNED');
  });
});

// ─── Mellizos, gemelos y hermanos ────────────────────────────────────────────

async function book(opts: {
  day: string;
  minute: number;
  treatmentId?: string;
  patientId?: string;
  patientName: string;
  patientPhone?: string;
}) {
  const { appointment } = await createAppointment(ctxFor(tenantId, userA), {
    professionalId,
    treatmentId: opts.treatmentId ?? null,
    patientId: opts.patientId ?? null,
    patientName: opts.patientName,
    patientPhone: opts.patientPhone ?? '',
    startDateKey: opts.day,
    startMinute: opts.minute,
    durationMinutes: 30,
  });
  return appointment;
}

async function familyTagOn(patientId: string, day: string) {
  const all = await listFamilyPatients(tenantId, 'Europe/Madrid');
  const fam = groupFamilies(all);
  const byId = new Map(all.map((p) => [p.id, p]));
  const me = byId.get(patientId) as FamilyPatient;
  const sibs = (fam.get(patientId) ?? []).map((id) => byId.get(id) as FamilyPatient);
  return familyTagFor(me, day, sibs);
}

describe('mellizos, gemelos y hermanos', () => {
  it('mellizos con nombre libre y tratamiento GEMELOS / MELLIZOS: G/M, nunca 1ª visita', async () => {
    const a = await book({
      day: '2027-03-01',
      minute: 15 * 60,
      treatmentId: tGemelos,
      patientName: '2 Dylan',
    });
    const b = await book({
      day: '2027-03-01',
      minute: 15 * 60 + 30,
      treatmentId: tGemelos,
      patientName: 'Uriel',
    });
    for (const ap of [a, b]) {
      expect(ap.isFirstVisit).toBe(false);
      expect(
        appointmentTypeTag({
          isFirstVisit: ap.isFirstVisit,
          treatmentName: 'GEMELOS / MELLIZOS',
          familyTag: null,
        }),
      ).toEqual({ firstVisit: false, familyTag: 'GM' });
    }
  });

  it('tres mellizos/hermanos GEMELOS seguidos no chocan con "no más de 2 primeras seguidas"', async () => {
    for (let i = 0; i < 3; i++) {
      await book({
        day: '2027-03-02',
        minute: 15 * 60 + i * 30,
        treatmentId: tGemelos,
        patientName: `Trillizo ${i}`,
      });
    }
    // Con PRIMERA VISITA, la tercera seguida sí se bloquea (la regla sigue viva).
    await book({
      day: '2027-03-03',
      minute: 15 * 60,
      treatmentId: tPrimera,
      patientName: 'Nuevo A',
    });
    await book({
      day: '2027-03-03',
      minute: 15 * 60 + 30,
      treatmentId: tPrimera,
      patientName: 'Nuevo B',
    });
    await expect(
      book({ day: '2027-03-03', minute: 16 * 60, treatmentId: tPrimera, patientName: 'Nuevo C' }),
    ).rejects.toBeInstanceOf(AgendaPolicyError);
  });

  it('mellizos con ficha, mismo móvil y misma fecha: G/M', async () => {
    const x = await kid('Hugo', 'Sáez Rey', '+34611300001', '2025-06-06');
    const y = await kid('Mateo', 'Sáez Rey', '+34611300001', '2025-06-06');
    expect(await familyTagOn(x.id, '2027-03-04')).toBe('GM');
    expect(await familyTagOn(y.id, '2027-03-04')).toBe('GM');
  });

  it('mellizos con el móvil de la madre en uno y el del padre en otro: G/M por los apellidos', async () => {
    const x = await kid('Dylan', 'Ortega Blanco', '+34611300002', '2025-07-07');
    const y = await kid('Uriel', 'Ortega Blanco', '+34611300003', '2025-07-07');
    expect(await familyTagOn(x.id, '2027-03-04')).toBe('GM');
    expect(await familyTagOn(y.id, '2027-03-04')).toBe('GM');
  });

  it('mellizos con ficha dados como PRIMERA VISITA: G/M, no 1ª visita', async () => {
    const x = await kid('Olivia', 'Cano Vela', '+34611300009', '2025-12-12');
    await kid('Elsa', 'Cano Vela', '+34611300009', '2025-12-12');
    const ap = await book({
      day: '2027-03-08',
      minute: 15 * 60,
      treatmentId: tPrimera,
      patientId: x.id,
      patientName: 'Olivia',
    });
    expect(ap.isFirstVisit).toBe(true);
    const fam = await familyTagOn(x.id, '2027-03-08');
    expect(
      appointmentTypeTag({
        isFirstVisit: ap.isFirstVisit,
        treatmentName: 'PRIMERA VISITA',
        familyTag: fam,
      }),
    ).toEqual({ firstVisit: false, familyTag: 'GM' });
  });

  it('un solo apellido en común no hace familia', async () => {
    const x = await kid('Sara', 'García', '+34611300004', '2025-08-08');
    await kid('Iker', 'García', '+34611300005', '2025-08-08');
    expect(await familyTagOn(x.id, '2027-03-04')).toBeNull();
  });

  it('hermano pequeño: H cuando el mayor ya vino; 1ª visita (H) en su primera', async () => {
    const mayor = await kid('Álex', 'Núñez Vidal', '+34611300006', '2022-01-01');
    const peque = await kid('Bea', 'Núñez Vidal', '+34611300006', '2025-09-09');
    await raw`insert into agenda_appointments (tenant_id, professional_id, patient_key, patient_id, patient_name, starts_at, ends_at, status)
      values (${tenantId}, ${professionalId}, ${`pat:${mayor.id}`}, ${mayor.id}, 'Álex', '2026-05-04 16:00+02', '2026-05-04 16:30+02', 'SCHEDULED')`;
    const ap = await book({
      day: '2027-03-05',
      minute: 15 * 60,
      treatmentId: tPrimera,
      patientId: peque.id,
      patientName: 'Bea',
    });
    const fam = await familyTagOn(peque.id, '2027-03-05');
    expect(fam).toBe('H');
    expect(
      appointmentTypeTag({
        isFirstVisit: ap.isFirstVisit,
        treatmentName: 'PRIMERA VISITA',
        familyTag: fam,
      }),
    ).toEqual({ firstVisit: true, familyTag: 'H' });
  });

  it('sin H si el mayor sólo faltó, o si su única cita es posterior', async () => {
    const mayor = await kid('Gael', 'Prieto Soto', '+34611300007', '2022-02-02');
    const peque = await kid('Vera', 'Prieto Soto', '+34611300007', '2025-10-10');
    await raw`insert into agenda_appointments (tenant_id, professional_id, patient_key, patient_id, patient_name, starts_at, ends_at, status)
      values (${tenantId}, ${professionalId}, ${`pat:${mayor.id}`}, ${mayor.id}, 'Gael', '2026-05-04 16:00+02', '2026-05-04 16:30+02', 'NO_SHOW'),
             (${tenantId}, ${professionalId}, ${`pat:${mayor.id}`}, ${mayor.id}, 'Gael', '2027-06-01 16:00+02', '2027-06-01 16:30+02', 'SCHEDULED')`;
    expect(await familyTagOn(peque.id, '2027-03-05')).toBeNull();
    // Desde su cita de junio sí: ya vino.
    expect(await familyTagOn(peque.id, '2027-06-02')).toBe('H');
  });

  it('tratamiento "…HERMANOS…" es H aunque la cita no tenga ficha', () => {
    expect(
      appointmentTypeTag({
        isFirstVisit: true,
        treatmentName: 'PRIMERA VISITA HERMANOS',
        familyTag: null,
      }),
    ).toEqual({ firstVisit: true, familyTag: 'H' });
    expect(tHermanos).toBeTruthy();
  });

  it('la marca a mano "Ninguno" quita la etiqueta calculada', async () => {
    const x = await kid('Nil', 'Ferrer Roca', '+34611300008', '2025-11-11');
    await kid('Pau', 'Ferrer Roca', '+34611300008', '2025-11-11');
    await raw`update patients set sibling_mark = 'NONE' where id = ${x.id}`;
    expect(await familyTagOn(x.id, '2027-03-04')).toBeNull();
  });
});
