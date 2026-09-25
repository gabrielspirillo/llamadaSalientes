import 'server-only';

import {
  type AgentSlotOption,
  diversifyByProfessional,
  findAgentSlots,
  getAgentPatientContext,
  listAgentProfessionals,
  matchByName,
  phoneHasHistory,
  systemAgendaContext,
} from '@/lib/agenda/agent';
import { getAppointment, getClinicTimezone, tenantHasAgenda } from '@/lib/agenda/queries';
import { AgendaValidationError, cancelAppointment, createAppointment } from '@/lib/agenda/service';
import { resolvePatientForBooking } from '@/lib/care-profile/agent';
import { getCareProfileSafe } from '@/lib/care-profile/queries';
import type { CancelledBy } from '@/lib/care-profile/signals';
import { clockArticle, speakClockTime } from '@/lib/retell/time-speech';
import { localDateKey } from '@/lib/tasks/tz';

/**
 * La agenda interna vista por los agentes virtuales (voz y WhatsApp).
 *
 * Todas las funciones devuelven `null` cuando la clínica NO usa la agenda
 * interna (ningún profesional con la agenda encendida) o cuando la consulta
 * falla. Ese `null` significa "sigue por donde ibas": quien llama cae al camino
 * de GoHighLevel de siempre. Así, encender la agenda de un profesional cambia
 * el comportamiento de los agentes sin migrar nada, y un fallo de base no deja
 * al agente sin poder dar cita.
 */
export type AgendaToolResult = { result: string } | null;

export interface AgendaAvailabilityArgs {
  treatment_name?: string;
  preferred_date?: string;
  professional_name?: string;
  /**
   * El paciente es nuevo. Si el agente no lo dice, se deduce del teléfono del
   * canal: sin ninguna cita previa, es primera visita. Sólo importa en las
   * clínicas con reglas de reserva.
   */
  first_visit?: boolean;
}

export interface AgendaAvailabilityContext {
  /** Teléfono del canal (quien llama o escribe), ya normalizado. */
  patientPhone?: string | null;
}

export interface AgendaBookArgs {
  start_time?: string;
  professional_id?: string;
  professional_name?: string;
  treatment_name?: string;
  patient_name?: string;
  /** Clínicas con perfil: el niño al que va la cita (`patients.id`). */
  patient_id?: string;
  phone?: string;
  email?: string;
  contact_id?: string;
  notes?: string;
  /** Idempotencia: la llamada o la conversación de la que sale la reserva. */
  dedupe_key?: string;
  /** Canal desde el que se reserva. Queda en la cita y en las métricas. */
  source?: 'VOICE_AGENT' | 'WHATSAPP_AGENT';
}

async function usesInternalAgenda(tenantId: string): Promise<boolean> {
  try {
    return await tenantHasAgenda(tenantId);
  } catch (err) {
    console.warn('[agenda-voice] no se pudo leer la agenda interna', err);
    return false;
  }
}

/** "el martes a las diez y media con la Dra. Ruiz" + el marcador que hay que repetir. */
function speakOption(option: AgentSlotOption, timezone: string): string {
  const weekday = option.start.toLocaleDateString('es-ES', { weekday: 'long', timeZone: timezone });
  const day = option.start.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    timeZone: timezone,
  });
  const time = speakClockTime(option.start, timezone);
  return `${weekday} ${day} ${clockArticle(time)} ${time} con ${option.professionalName} [start_time=${option.start.toISOString()} professional_id=${option.professionalId}]`;
}

/**
 * Qué profesional(es) realiza cada tratamiento, según la agenda interna.
 * Devuelve `null` si la clínica no usa la agenda interna (ahí no hay forma de
 * saber quién hace qué y no se debe atribuir a nadie). Clave: id del tratamiento.
 */
export async function agendaTreatmentProfessionals(
  tenantId: string,
): Promise<Map<string, string[]> | null> {
  if (!(await usesInternalAgenda(tenantId))) return null;
  try {
    const catalog = await listAgentProfessionals(tenantId);
    const map = new Map<string, string[]>();
    for (const p of catalog) {
      for (const t of p.treatments) {
        const arr = map.get(t.id) ?? [];
        if (!arr.includes(p.fullName)) arr.push(p.fullName);
        map.set(t.id, arr);
      }
    }
    return map;
  } catch (err) {
    console.error('[agenda-voice] treatment_professionals', err);
    return null;
  }
}

export async function agendaCheckAvailability(
  tenantId: string,
  args: AgendaAvailabilityArgs,
  ctx: AgendaAvailabilityContext = {},
): Promise<AgendaToolResult> {
  if (!(await usesInternalAgenda(tenantId))) return null;

  try {
    // Primera visita: lo que diga el agente y, si no lo dice, lo que sepa la
    // agenda del teléfono. Un fallo al mirarlo no puede dejar sin huecos: se
    // asume paciente conocido y las reglas se vuelven a comprobar al reservar.
    const firstVisit =
      typeof args.first_visit === 'boolean'
        ? args.first_visit
        : ctx.patientPhone
          ? !(await phoneHasHistory(tenantId, ctx.patientPhone).catch(() => true))
          : false;

    const search = await findAgentSlots(tenantId, {
      treatmentName: args.treatment_name ?? null,
      professionalName: args.professional_name ?? null,
      preferredDate: args.preferred_date ?? null,
      days: 7,
      limitPerProfessional: 3,
      firstVisit,
    });

    if (search.reason === 'NO_AGENDA') return null;

    // El tratamiento existe pero ningún profesional lo realiza: no se ofrece con
    // cualquiera. El agente tiene que decir que no lo hacen y pasar a recepción.
    if (search.reason === 'NO_PROFESSIONAL_FOR_TREATMENT' && search.matchedTreatment) {
      return {
        result: `Ningún profesional de la clínica realiza ${search.matchedTreatment.name} con la agenda online. NO lo agendes con otro profesional: decile al paciente que ese servicio no está disponible para reserva automática y ofrecele pasar con recepción o elegir otro tratamiento.`,
      };
    }

    if (search.options.length === 0) {
      const quien = search.matchedProfessional
        ? `${search.matchedProfessional.fullName} no tiene`
        : 'No hay';
      return {
        result: `${quien} huecos libres en esos días. Ofrecele al paciente otra fecha o preguntale si le sirve otro profesional.`,
      };
    }

    // Se ofrecen pocas: por teléfono/chat, más de tres opciones no se retienen.
    // Diversificamos por profesional para no ofrecer sólo la agenda del primero
    // cuando hay varios especialistas que hacen el tratamiento.
    const picked = diversifyByProfessional(search.options, 3);
    const spoken = picked.map((o) => speakOption(o, search.timezone));
    const tratamiento = search.matchedTreatment ? ` para ${search.matchedTreatment.name}` : '';

    // Aviso de que hay varios especialistas: el agente tiene que ofrecer elegir,
    // no dar por hecho el primero. Sólo si el paciente no pidió uno concreto.
    const varios =
      !search.matchedProfessional && search.offeredBy.length > 1
        ? ` Varios profesionales atienden este tratamiento: ${search.offeredBy
            .map((p) => p.fullName)
            .join(
              ', ',
            )}. Si el paciente no dijo con quién, preguntale si tiene preferencia antes de reservar; si le da igual, ofrecele el hueco más próximo.`
        : '';

    return {
      result: `Huecos libres${tratamiento}: ${spoken.join('; ')}.${varios} Para reservar, el paciente tiene que ELEGIR un hueco concreto (día, hora Y profesional). Un "sí" o "dale" ambiguo NO es una elección: preguntale cuál de los horarios prefiere. Luego pasá a book_appointment el start_time y el professional_id EXACTOS de ESE hueco, tal cual aparecen entre corchetes. Al paciente decile sólo el día, la hora y el nombre del profesional.`,
    };
  } catch (err) {
    console.error('[agenda-voice] check_availability', err);
    return null;
  }
}

export async function agendaBookAppointment(
  tenantId: string,
  args: AgendaBookArgs,
): Promise<AgendaToolResult> {
  if (!(await usesInternalAgenda(tenantId))) return null;

  try {
    const catalog = await listAgentProfessionals(tenantId);
    if (catalog.length === 0) return null;

    // El id del hueco es lo fiable; el nombre, lo que el agente entendió.
    let professional = args.professional_id
      ? (catalog.find((p) => p.id === args.professional_id) ?? null)
      : null;
    if (!professional && args.professional_name) {
      professional = matchByName(args.professional_name, catalog, (p) => p.fullName);
    }
    if (!professional && catalog.length === 1) professional = catalog[0] ?? null;

    if (!professional) {
      return {
        result:
          'Necesito saber con qué profesional. Llamá primero a check_availability y usá el professional_id que te devuelve entre corchetes.',
      };
    }
    if (!professional.acceptsOnlineBooking) {
      return {
        result: `${professional.fullName} no acepta reservas automáticas. Tomá nombre y teléfono y decile al paciente que recepción le confirma.`,
      };
    }
    if (!args.start_time) {
      return {
        result:
          'Falta la hora exacta. Llamá a check_availability y pasá el start_time que te devuelve, sin recalcularlo.',
      };
    }

    // Clínica con perfil de atención: la cita va al NIÑO, que tiene ficha.
    // Sin ficha no se reserva; de ella salen la edad y el aviso médico.
    let patientId: string | null = null;
    let patientName = args.patient_name?.trim() ?? '';
    const careProfile = await getCareProfileSafe(tenantId);
    if (careProfile) {
      const resolved = await resolvePatientForBooking(
        tenantId,
        { patientId: args.patient_id, patientName, phone: args.phone },
        careProfile,
      );
      if (!resolved.ok) return { result: resolved.result };
      patientId = resolved.person.id;
      patientName = resolved.person.fullName;
    }

    if (!patientName) {
      return {
        result: 'Necesito el nombre del paciente para dejar la cita a su nombre.',
      };
    }

    const treatment = args.treatment_name
      ? matchByName(args.treatment_name, professional.treatments, (t) => t.name)
      : null;

    // Invariante: un profesional sólo recibe citas de los tratamientos que tiene
    // asignados. Si el paciente pidió un tratamiento que ESTE profesional no hace
    // (y el profesional sí tiene lista de tratamientos), no se reserva: antes
    // caía a treatmentId=null con 30 min por defecto, agendando p.ej. un implante
    // con quien no lo realiza y solapando la agenda.
    if (args.treatment_name && !treatment && professional.treatments.length > 0) {
      return {
        result: `${professional.fullName} no realiza "${args.treatment_name}". NO reserves ese tratamiento con ${professional.fullName}. Llamá a check_availability con el tratamiento para ver qué profesional lo hace, o pasá con recepción.`,
      };
    }

    const { appointment, deduped } = await createAppointment(systemAgendaContext(tenantId), {
      professionalId: professional.id,
      treatmentId: treatment?.id ?? null,
      patientId,
      patientName,
      patientPhone: args.phone ?? '',
      patientEmail: args.email ?? '',
      ghlContactId: args.contact_id ?? '',
      startsAt: args.start_time,
      durationMinutes: treatment?.durationMinutes,
      notes: args.notes ?? '',
      source: args.source ?? 'VOICE_AGENT',
      dedupeKey: args.dedupe_key,
    });

    const timezone = await getClinicTimezone(tenantId);
    const cuando = `${localDateKey(appointment.startsAt, timezone)} ${speakClockTime(appointment.startsAt, timezone)}`;

    return {
      result: deduped
        ? `Esa cita ya estaba agendada (${cuando} con ${professional.fullName}). No se duplicó.`
        : `Cita agendada: ${cuando} con ${professional.fullName}. Confirmale al paciente el día, la hora y el profesional.`,
    };
  } catch (err) {
    if (err instanceof AgendaValidationError) {
      // El motivo ya viene en español y es accionable ("se pisa con otra cita").
      return { result: `${err.message} Ofrecele otro hueco con check_availability.` };
    }
    console.error('[agenda-voice] book_appointment', err);
    return null;
  }
}

export async function agendaCancelAppointment(
  tenantId: string,
  appointmentId: string,
  cancelledBy: CancelledBy = 'PATIENT',
): Promise<AgendaToolResult> {
  if (!(await usesInternalAgenda(tenantId))) return null;
  // Los ids de la agenda interna son UUID; los de GHL, alfanuméricos de 20.
  // Si no lo es, esto no es una cita nuestra: que siga el camino de GHL.
  if (!/^[0-9a-f-]{36}$/i.test(appointmentId)) return null;

  try {
    const appointment = await getAppointment(tenantId, appointmentId);
    if (!appointment) return null;
    await cancelAppointment(
      systemAgendaContext(tenantId),
      appointmentId,
      cancelledBy === 'CLINIC' ? 'Movida a un hueco anterior' : 'Cancelada por el agente',
      cancelledBy,
    );
    return { result: 'La cita quedó cancelada y el hueco vuelve a estar libre.' };
  } catch (err) {
    console.error('[agenda-voice] cancel_appointment', err);
    return null;
  }
}

/** Próxima cita del paciente en la agenda, si la clínica la usa. */
export async function agendaPatientSummary(
  tenantId: string,
  identity: { phone?: string | null; ghlContactId?: string | null },
): Promise<string | null> {
  if (!(await usesInternalAgenda(tenantId))) return null;

  try {
    const context = await getAgentPatientContext(tenantId, identity);
    if (!context) return null;

    const timezone = await getClinicTimezone(tenantId);
    const parts: string[] = [];

    if (context.nextAppointment) {
      const a = context.nextAppointment;
      parts.push(
        `Tiene cita el ${localDateKey(a.startsAt, timezone)} ${speakClockTime(a.startsAt, timezone)} con ${a.professionalName}${a.treatmentName ? ` para ${a.treatmentName}` : ''} (appointment_id=${a.id}).`,
      );
    }
    if (context.lastVisitAt) {
      parts.push(
        `Última visita: ${localDateKey(context.lastVisitAt, timezone)}${context.lastProfessionalName ? ` con ${context.lastProfessionalName}` : ''}.`,
      );
    }
    if (context.pendingFollowUp) {
      parts.push(`Pendiente de la última consulta: ${context.pendingFollowUp}.`);
    }

    return parts.length > 0 ? parts.join(' ') : null;
  } catch (err) {
    console.error('[agenda-voice] patient summary', err);
    return null;
  }
}

/**
 * Quién pasa consulta, qué hace cada uno, cuándo trabaja y cuándo no está.
 *
 * Es lo que le permite al agente responder "la doctora Ruiz atiende de lunes a
 * viernes por la mañana, pero la semana que viene no está" sin tener que pedir
 * una fecha y consultar huecos para averiguarlo.
 */
export async function agendaListProfessionals(tenantId: string): Promise<AgendaToolResult> {
  if (!(await usesInternalAgenda(tenantId))) return null;

  try {
    const catalog = await listAgentProfessionals(tenantId);
    if (catalog.length === 0) return null;

    const lines = catalog.map((p) => {
      const what =
        p.treatments.length > 0
          ? p.treatments
              .map((t) => t.name)
              .slice(0, 6)
              .join(', ')
          : 'sin tratamientos asignados (no le atribuyas tratamientos que no tenga a su nombre)';
      const partes = [
        `- ${p.fullName}${p.specialty ? ` (${p.specialty})` : ''}`,
        `hace: ${what}`,
        `horario: ${p.schedule}`,
      ];
      if (p.absences) partes.push(`no está: ${p.absences}`);
      if (!p.acceptsOnlineBooking)
        partes.push('no se le reserva automáticamente: pasa a recepción');
      return partes.join(' | ');
    });

    return {
      result: `Profesionales de la clínica:\n${lines.join('\n')}\nEse horario es el habitual: para dar una hora concreta usá SIEMPRE check_availability con professional_name, que ya descuenta citas y ausencias.`,
    };
  } catch (err) {
    console.error('[agenda-voice] list_professionals', err);
    return null;
  }
}
