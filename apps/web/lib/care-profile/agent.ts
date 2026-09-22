import 'server-only';

import { getAgentPatientContext, matchByName, normalizeName } from '@/lib/agenda/agent';
import { normalizePatientPhone } from '@/lib/agenda/patients';
import { getClinicTimezone } from '@/lib/agenda/queries';
import {
  type CareProfile,
  PRIORITY_LABELS,
  ageAt,
  describeAge,
  describeAgeRange,
  describeAnamnesis,
  isPatientAgeAllowed,
  priorityLevel,
} from '@/lib/care-profile/policy';
import {
  type PatientPerson,
  createPatient,
  getPatientPerson,
  listPatientsForPhone,
  setPatientReview,
} from '@/lib/patients/persons';
import { findPatientByPhone } from '@/lib/patients/registry';
import { speakClockTime } from '@/lib/retell/time-speech';
import { localDateKey } from '@/lib/tasks/tz';

/**
 * Lo que los asistentes (voz y WhatsApp) hacen distinto en una clínica con
 * perfil de atención: el paciente es el niño, no el teléfono.
 *
 * Todo lo que el prompt les pide, aquí se impone además en el servidor: la
 * edad admitida, la fecha de nacimiento obligatoria, el aviso médico que
 * bloquea la cita y el `patient_id` al reservar. Un modelo puede saltarse
 * una instrucción; no puede saltarse esto.
 */

export type ToolResult = { result: string };

function todayKeyFor(timezone: string): string {
  return localDateKey(new Date(), timezone);
}

function describeChild(person: PatientPerson, todayKey: string): string {
  return person.birthDate
    ? `${person.fullName} (${describeAge(person.birthDate, todayKey) ?? 'sin edad'})`
    : `${person.fullName} (sin fecha de nacimiento)`;
}

// ─── Alta del niño ───────────────────────────────────────────────────────────

export interface RegisterPersonArgs {
  firstName: string;
  lastName?: string | null;
  /** Teléfono del tutor, ya normalizado. */
  phone: string;
  guardianName?: string | null;
  /** 'YYYY-MM-DD'. Obligatoria: sin ella no hay edad, y la edad decide todo. */
  birthDate?: string | null;
  /** Lo que contó el tutor y que la clínica quiere valorar en persona. */
  medicalAlert?: string | null;
}

export async function registerPatientPerson(
  tenantId: string,
  args: RegisterPersonArgs,
  profile: CareProfile,
): Promise<ToolResult> {
  const birthDate = args.birthDate?.trim();
  if (!birthDate) {
    return {
      result:
        'En esta clínica el paciente es el niño y hace falta su fecha de nacimiento para darlo de alta. Pídesela al tutor y vuelve a llamar a register_patient con birth_date en formato YYYY-MM-DD.',
    };
  }

  const timezone = await getClinicTimezone(tenantId);
  const todayKey = todayKeyFor(timezone);
  const age = ageAt(birthDate, todayKey);
  if (!age) {
    return {
      result:
        'Esa fecha de nacimiento no es válida o es futura. Confírmala con el tutor y pásala como YYYY-MM-DD.',
    };
  }

  if (!isPatientAgeAllowed(age.totalMonths, profile.bookingPolicy)) {
    const range = describeAgeRange(profile.bookingPolicy) ?? 'de la edad admitida';
    return {
      result: `NO se da de alta: la clínica sólo atiende a bebés y niños ${range} y este tiene ${describeAge(birthDate, todayKey)}. Explícaselo con amabilidad, no des cita y no insistas.`,
    };
  }

  const fullName = [args.firstName, args.lastName]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(' ');

  // Idempotencia: el mismo niño dicho dos veces en la misma conversación (o en
  // otra llamada) no puede acabar en dos fichas. Mismo teléfono y mismo nombre
  // basta; la fecha de nacimiento desempata cuando el nombre se repite.
  const siblings = await listPatientsForPhone(tenantId, args.phone);
  const existing =
    siblings.find(
      (p) => normalizeName(p.fullName) === normalizeName(fullName) && p.birthDate === birthDate,
    ) ??
    siblings.find(
      (p) =>
        normalizeName(p.firstName) === normalizeName(args.firstName) && p.birthDate === birthDate,
    ) ??
    null;

  const person =
    existing ??
    (await createPatient(
      { tenantId, userId: null },
      {
        firstName: args.firstName.trim(),
        lastName: args.lastName?.trim() ?? '',
        birthDate,
        contactPhone: args.phone,
        contactName: args.guardianName?.trim() ?? '',
        notes: '',
      },
    ));

  const alert = args.medicalAlert?.trim();
  if (alert) {
    await setPatientReview({ tenantId, userId: null }, person.id, {
      needsHumanReview: true,
      reviewReason: alert,
    });
    return {
      result: `${describeChild(person, todayKey)} queda registrado con un aviso para el equipo: "${alert}". NO le des cita: dile al tutor que una persona de la clínica le llamará para valorar el caso y pasa la conversación a una persona del equipo.`,
    };
  }

  const fasting = profile.bookingPolicy.fastingHours;
  return {
    result: `${existing ? 'Ya estaba registrado' : 'Paciente dado de alta'}: ${describeChild(person, todayKey)}. patient_id=${person.id}. Para reservar, llamá a check_availability con first_visit=${existing ? 'false' : 'true'} y después a book_appointment con patient_id=${person.id} y el start_time y professional_id exactos del hueco elegido.${
      fasting ? ` Recuérdale al tutor el ayuno de ${fasting} horas antes de la sesión.` : ''
    }`,
  };
}

// ─── Ficha por teléfono ──────────────────────────────────────────────────────

/** Lo que un asistente sabe del teléfono que llama o escribe: sus niños. */
export async function describePatientsForPhone(
  tenantId: string,
  phone: string | null | undefined,
  profile: CareProfile,
): Promise<ToolResult> {
  const phoneE164 = normalizePatientPhone(phone);
  if (!phoneE164) {
    return {
      result:
        'Necesito el teléfono del tutor en formato internacional (por ejemplo +34600111222) para buscar a sus niños.',
    };
  }

  const [children, contact, timezone] = await Promise.all([
    listPatientsForPhone(tenantId, phoneE164),
    findPatientByPhone(tenantId, phoneE164).catch(() => null),
    getClinicTimezone(tenantId),
  ]);
  const todayKey = todayKeyFor(timezone);

  if (children.length === 0) {
    return {
      result:
        'Con este teléfono no hay ningún niño registrado: es una PRIMERA VISITA. Sigue el protocolo de primera visita y da de alta al niño con register_patient (nombre, apellidos, fecha de nacimiento y nombre del titular del teléfono).',
    };
  }

  const lines = await Promise.all(
    children.map(async (p) => {
      const parts = [`- ${describeChild(p, todayKey)}, patient_id=${p.id}`];

      const ageMonths = p.birthDate ? (ageAt(p.birthDate, todayKey)?.totalMonths ?? null) : null;
      const level = priorityLevel(
        { ageMonths, priorityFlag: p.priorityFlag },
        profile.bookingPolicy,
      );
      if (level !== 'NORMAL') {
        parts.push(
          `${PRIORITY_LABELS[level].toUpperCase()}${p.priorityReason ? ` (${p.priorityReason})` : ''}`,
        );
      }
      if (p.needsHumanReview) {
        parts.push(
          `REQUIERE VALORACIÓN DE UNA PERSONA antes de dar cita${p.reviewReason ? ` (${p.reviewReason})` : ''}: no reserves, pasa a recepción`,
        );
      }

      const anamnesis = describeAnamnesis(profile.anamnesisTemplate, p.anamnesis);
      if (anamnesis) parts.push(`anamnesis: ${anamnesis}`);

      const agenda = await getAgentPatientContext(tenantId, { patientId: p.id }).catch(() => null);
      if (agenda?.nextAppointment) {
        const a = agenda.nextAppointment;
        parts.push(
          `próxima cita ${localDateKey(a.startsAt, timezone)} ${speakClockTime(a.startsAt, timezone)} con ${a.professionalName} (appointment_id=${a.id})`,
        );
      }
      if (agenda?.lastVisitAt) {
        parts.push(`última visita ${localDateKey(agenda.lastVisitAt, timezone)}`);
      }
      if (agenda?.pendingFollowUp) parts.push(`pendiente: ${agenda.pendingFollowUp}`);

      return parts.join(' · ');
    }),
  );

  const tutor = contact?.name?.trim() || contact?.firstName?.trim() || null;
  return {
    result: `Este teléfono es de ${tutor ?? 'un tutor'}. Niños registrados:\n${lines.join('\n')}\nPregunta para cuál de ellos es la cita si hay más de uno. Para reservar, book_appointment con su patient_id. Un hermano nuevo se da de alta con register_patient.`,
  };
}

// ─── Reservar: a quién ────────────────────────────────────────────────────────

export type PatientResolution = { ok: true; person: PatientPerson } | { ok: false; result: string };

/**
 * El niño al que va la cita. Por `patient_id` cuando el agente lo pasa, y si
 * no, por el nombre entre los niños de ese teléfono. Sin ficha no se reserva:
 * la edad y el aviso médico salen de ella.
 */
export async function resolvePatientForBooking(
  tenantId: string,
  args: { patientId?: string | null; patientName?: string | null; phone?: string | null },
  profile: CareProfile,
): Promise<PatientResolution> {
  let person: PatientPerson | null = null;

  if (args.patientId?.trim()) {
    person = await getPatientPerson(tenantId, args.patientId.trim()).catch(() => null);
    if (!person) {
      return {
        ok: false,
        result:
          'Ese patient_id no existe en esta clínica. Llamá a get_patient_info con el teléfono para ver los niños registrados y usá el patient_id que devuelva.',
      };
    }
  }

  if (!person && args.patientName?.trim() && args.phone) {
    const children = await listPatientsForPhone(tenantId, args.phone);
    person = matchByName(args.patientName, children, (c) => c.fullName);
  }

  if (!person) {
    return {
      ok: false,
      result:
        'En esta clínica cada niño tiene su ficha y la cita va a su nombre. Llamá a get_patient_info para ver los niños registrados con este teléfono, o da de alta al niño con register_patient (nombre, apellidos, fecha de nacimiento), y reservá con su patient_id.',
    };
  }

  if (person.needsHumanReview) {
    return {
      ok: false,
      result: `${person.fullName} tiene que valorarlo una persona del equipo antes de dar cita${
        person.reviewReason ? ` (${person.reviewReason})` : ''
      }. No reserves: dile al tutor que le llamarán y pasa la conversación a recepción.`,
    };
  }

  if (person.birthDate) {
    const timezone = await getClinicTimezone(tenantId);
    const todayKey = todayKeyFor(timezone);
    const age = ageAt(person.birthDate, todayKey);
    if (age && !isPatientAgeAllowed(age.totalMonths, profile.bookingPolicy)) {
      const range = describeAgeRange(profile.bookingPolicy) ?? 'de la edad admitida';
      return {
        ok: false,
        result: `${person.fullName} tiene ${describeAge(person.birthDate, todayKey)} y la clínica sólo atiende a niños ${range}. Explícaselo con amabilidad y no des cita.`,
      };
    }
  }

  return { ok: true, person };
}
