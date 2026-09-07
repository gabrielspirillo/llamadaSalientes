import 'server-only';

import {
  type AgentSlotOption,
  findAgentSlots,
  getAgentPatientContext,
  listAgentProfessionals,
  matchByName,
  systemAgendaContext,
} from '@/lib/agenda/agent';
import { getAppointment, getClinicTimezone, tenantHasAgenda } from '@/lib/agenda/queries';
import { AgendaValidationError, cancelAppointment, createAppointment } from '@/lib/agenda/service';
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
}

export interface AgendaBookArgs {
  start_time?: string;
  professional_id?: string;
  professional_name?: string;
  treatment_name?: string;
  patient_name?: string;
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

export async function agendaCheckAvailability(
  tenantId: string,
  args: AgendaAvailabilityArgs,
): Promise<AgendaToolResult> {
  if (!(await usesInternalAgenda(tenantId))) return null;

  try {
    const search = await findAgentSlots(tenantId, {
      treatmentName: args.treatment_name ?? null,
      professionalName: args.professional_name ?? null,
      preferredDate: args.preferred_date ?? null,
      days: 7,
      limitPerProfessional: 3,
    });

    if (search.reason === 'NO_AGENDA') return null;

    if (search.options.length === 0) {
      const quien = search.matchedProfessional
        ? `${search.matchedProfessional.fullName} no tiene`
        : 'No hay';
      return {
        result: `${quien} huecos libres en esos días. Ofrecele al paciente otra fecha o preguntale si le sirve otro profesional.`,
      };
    }

    // Se ofrecen pocas: por teléfono, más de tres opciones no se retienen.
    const spoken = search.options.slice(0, 3).map((o) => speakOption(o, search.timezone));
    const tratamiento = search.matchedTreatment ? ` para ${search.matchedTreatment.name}` : '';

    return {
      result: `Huecos libres${tratamiento}: ${spoken.join('; ')}. Para reservar, pasá a book_appointment el start_time y el professional_id EXACTOS del hueco que elija el paciente, tal cual aparecen entre corchetes. Al paciente decile sólo el día, la hora y el nombre del profesional.`,
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
    if (!args.patient_name?.trim()) {
      return {
        result: 'Necesito el nombre del paciente para dejar la cita a su nombre.',
      };
    }

    const treatment = args.treatment_name
      ? matchByName(args.treatment_name, professional.treatments, (t) => t.name)
      : null;

    const { appointment, deduped } = await createAppointment(systemAgendaContext(tenantId), {
      professionalId: professional.id,
      treatmentId: treatment?.id ?? null,
      patientName: args.patient_name,
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
      'Cancelada por el agente',
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

/** Quién pasa consulta y qué hace cada uno. */
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
          : 'todos los tratamientos del catálogo';
      const reserva = p.acceptsOnlineBooking ? '' : ' — no se le puede reservar automáticamente';
      return `- ${p.fullName}${p.specialty ? ` (${p.specialty})` : ''}: ${what}${reserva}`;
    });

    return {
      result: `Profesionales de la clínica:\n${lines.join('\n')}\nPara ver sus huecos usá check_availability con professional_name.`,
    };
  } catch (err) {
    console.error('[agenda-voice] list_professionals', err);
    return null;
  }
}
