import { patientHasHistory } from '@/lib/agenda/first-visit';
import 'server-only';

import { getAgentPatientContext, matchByName, normalizeName } from '@/lib/agenda/agent';
import { normalizePatientPhone } from '@/lib/agenda/patients';
import { getClinicTimezone } from '@/lib/agenda/queries';
import { BUSY_STATUSES } from '@/lib/agenda/shared';
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
import { db } from '@/lib/db/client';
import { agendaAppointments } from '@/lib/db/schema';
import {
  DuplicatePatientError,
  type PatientPerson,
  createPatient,
  getPatientPerson,
  listPatientsForPhone,
  setPatientReview,
} from '@/lib/patients/persons';
import { findPatientByPhone } from '@/lib/patients/registry';
import { speakClockTime } from '@/lib/retell/time-speech';
import { localDateKey } from '@/lib/tasks/tz';
import { and, eq, inArray } from 'drizzle-orm';

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
        'En esta clínica el paciente es el niño y hace falta su fecha de nacimiento para darlo de alta. Pregúntale al tutor cuándo nació (día, mes y año, con naturalidad: no le pidas ningún formato) y vuelve a llamar a register_patient con birth_date como YYYY-MM-DD.',
    };
  }

  const timezone = await getClinicTimezone(tenantId);
  const todayKey = todayKeyFor(timezone);
  // Un bebé nacido hoy no viene a fisioterapia: es la fecha que pone el modelo
  // cuando no se la han dicho.
  if (birthDate >= todayKey) {
    return {
      result:
        'Esa fecha de nacimiento es la de hoy o posterior: no te la ha dicho el tutor. Pregúntale cuándo nació el niño (día, mes y año) y vuelve a llamar con la fecha que te diga.',
    };
  }
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

  // El modelo rellena lo que no sabe ("[pendiente]", "Hija"): una ficha así
  // acaba en la agenda y en la confirmación al tutor.
  if (isPlaceholderName(args.firstName)) {
    return {
      result:
        'Falta el nombre del niño. Pregúntale al tutor cómo se llama (nombre y apellidos) y vuelve a llamar a register_patient con ese nombre.',
    };
  }
  const fullName = [args.firstName, args.lastName]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(' ');

  // Idempotencia: el mismo niño dicho dos veces (en esta conversación, en otra
  // llamada o desde el móvil del otro tutor) no puede acabar en dos fichas. Si
  // el nombre coincide con un hijo de ese teléfono es ESE niño aunque la fecha
  // dictada no cuadre: abrirle otra ficha dejaría su historia en la vieja y las
  // citas nuevas en la vacía. La fecha sólo desempata.
  const siblings = await listPatientsForPhone(tenantId, args.phone);
  const sameName = (p: (typeof siblings)[number]) =>
    normalizeName(p.fullName) === normalizeName(fullName) ||
    normalizeName(p.firstName) === normalizeName(args.firstName);
  const existing =
    siblings.find((p) => sameName(p) && p.birthDate === birthDate) ??
    siblings.find((p) => normalizeName(p.fullName) === normalizeName(fullName)) ??
    siblings.find(sameName) ??
    null;
  if (existing) return finishRegistration(tenantId, existing, true, args, profile, todayKey);

  // Para una ficha NUEVA hacen falta los apellidos.
  if (!args.lastName?.trim() || isPlaceholderName(args.lastName)) {
    const family = siblings.map((p) => p.lastName).filter(Boolean);
    return {
      result: family.length
        ? `Faltan los apellidos de ${args.firstName.trim()}. Pregúntale al tutor si son ${family[0]}, como su hermano, y vuelve a llamar con last_name.`
        : `Faltan los apellidos de ${args.firstName.trim()}. Pregúntaselos al tutor y vuelve a llamar con last_name.`,
    };
  }

  try {
    const created = await createPatient(
      { tenantId, userId: null },
      {
        firstName: args.firstName.trim(),
        lastName: args.lastName?.trim() ?? '',
        birthDate,
        contactPhone: args.phone,
        contactName: cleanGuardianName(args.guardianName, fullName),
        notes: '',
      },
    );
    return finishRegistration(tenantId, created, false, args, profile, todayKey);
  } catch (err) {
    // Ya tenía ficha con otro teléfono de la familia: es esa.
    if (!(err instanceof DuplicatePatientError)) throw err;
    return finishRegistration(tenantId, err.existing, true, args, profile, todayKey);
  }
}

/** "[pendiente]", "Hija", "Niño", "desconocido"…: no es un nombre. */
export function isPlaceholderName(raw: string | null | undefined): boolean {
  const name = raw?.trim() ?? '';
  if (!name) return true;
  if (/[[\]{}<>]/.test(name)) return true;
  return /^(pendiente|desconocid[oa]|sin nombre|no indicad[oa]|n\/?a|hij[oa]|niñ[oa]|bebé|bebe|peque|paciente|tutor)$/i.test(
    name,
  );
}

/**
 * El modelo rellena el tutor con lo que tenga a mano ("Titular del teléfono",
 * el nombre del propio niño). Mejor sin nombre que con uno falso en la ficha.
 */
export function cleanGuardianName(raw: string | null | undefined, childName: string): string {
  const name = raw?.trim() ?? '';
  if (!name) return '';
  if (/titular|tel[eé]fono|tutor|madre o padre|desconocid|no indicad/i.test(name)) return '';
  if (normalizeName(name) === normalizeName(childName)) return '';
  return name;
}

async function finishRegistration(
  tenantId: string,
  person: PatientPerson,
  existing: boolean,
  args: RegisterPersonArgs,
  profile: CareProfile,
  todayKey: string,
): Promise<ToolResult> {
  // Primera visita = el niño no tiene ninguna cita que ocupe hueco, aunque ya
  // tuviera ficha (registrado en otra llamada y sin venir nunca).
  const [prior] = existing
    ? await db
        .select({ id: agendaAppointments.id })
        .from(agendaAppointments)
        .where(
          and(
            eq(agendaAppointments.tenantId, tenantId),
            eq(agendaAppointments.patientId, person.id),
            inArray(agendaAppointments.status, BUSY_STATUSES),
          ),
        )
        .limit(1)
    : [];
  const firstVisit = !prior;

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
  // Mellizos: el segundo va con el tratamiento de mellizos, sin la regla de
  // primeras visitas seguidas, y justo detrás de su hermano.
  const twins = person.birthDate
    ? (await listPatientsForPhone(tenantId, args.phone)).filter(
        (p) => p.id !== person.id && p.birthDate === person.birthDate,
      )
    : [];
  const twinHint = twins.length
    ? ` Es MELLIZO/GEMELO de ${twins.map((t) => t.fullName).join(' y ')}: si su hermano ya tiene cita, busca con check_availability el tratamiento de mellizos (first_visit=false) el mismo día y ofrécele la hora justo después de la de su hermano.`
    : '';
  return {
    result: `${existing ? 'Ya estaba registrado' : 'Paciente dado de alta'}: ${describeChild(person, todayKey)}. patient_id=${person.id}. Para reservar, llamá a check_availability con first_visit=${firstVisit ? 'true' : 'false'} y después a book_appointment con patient_id=${person.id} y el start_time y professional_id exactos del hueco elegido.${twinHint}${
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

      // Hermanos del mismo teléfono: misma fecha de nacimiento = mellizos/gemelos.
      const others = children.filter((o) => o.id !== p.id);
      const twins = others.filter((o) => p.birthDate && o.birthDate === p.birthDate);
      if (p.siblingMark === 'TWIN' || twins.length > 0) {
        parts.push(
          `MELLIZO/GEMELO${twins.length ? ` de ${twins.map((t) => t.firstName).join(', ')}` : ''}`,
        );
      } else if (p.siblingMark === 'SIBLING' || others.length > 0) {
        parts.push(
          `HERMANO/A${others.length ? ` de ${others.map((t) => t.firstName).join(', ')}` : ''}`,
        );
      }

      const returning = await patientHasHistory(tenantId, { patientId: p.id }).catch(() => false);
      parts.push(
        returning
          ? 'YA VINO ANTES: NO es primera visita (usa el tratamiento de seguimiento)'
          : 'sin visitas aún: su primera cita es PRIMERA VISITA',
      );

      return parts.join(' · ');
    }),
  );

  const tutor = contact?.name?.trim() || contact?.firstName?.trim() || null;
  return {
    result: `Este teléfono es de ${tutor ?? 'un tutor'}. Niños registrados:\n${lines.join('\n')}\nPregunta para cuál de ellos es la cita si hay más de uno. Para buscar huecos pasa su patient_id a check_availability y para reservar, a book_appointment. Un hermano nuevo se da de alta con register_patient.`,
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
