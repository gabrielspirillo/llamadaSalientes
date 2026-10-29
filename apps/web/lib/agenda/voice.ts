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
import { isUuid } from '@/lib/agenda/appointment-ref';
import { firstVisitFromTreatment } from '@/lib/agenda/availability';
import { pickAppointmentsToCancel } from '@/lib/agenda/cancel-match';
import { withinClinicHours } from '@/lib/agenda/clinic-hours';
import { decideFirstVisit, patientHasHistory } from '@/lib/agenda/first-visit';
import { normalizePatientPhone } from '@/lib/agenda/patients';
import {
  getAppointment,
  getAvailability,
  getClinicTimezone,
  tenantHasAgenda,
} from '@/lib/agenda/queries';
import { AgendaValidationError, cancelAppointment, createAppointment } from '@/lib/agenda/service';
import { BUSY_STATUSES } from '@/lib/agenda/shared';
import { matchRequestedSlot } from '@/lib/agenda/slot-match';
import { resolvePatientForBooking } from '@/lib/care-profile/agent';
import { getCareProfileSafe } from '@/lib/care-profile/queries';
import type { CancelledBy } from '@/lib/care-profile/signals';
import { db } from '@/lib/db/client';
import { agendaAppointments, clinicSettings, professionals, treatments } from '@/lib/db/schema';
import { clockArticle, speakClockTime } from '@/lib/retell/time-speech';
import { addDaysToKey, localDateKey } from '@/lib/tasks/tz';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';

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
  /** Ficha del paciente: decide si ya tiene historia. */
  patient_id?: string;
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
/**
 * El start_time que se le da al agente: la hora de la clínica tal cual
 * ("2026-11-03 16:00"), sin zona. Un ISO en UTC lo reescribía mal y la cita
 * salía corrida; al reservar, `matchRequestedSlot` lo interpreta igual.
 */
function localSlotKey(date: Date, timezone: string): string {
  const time = date.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  });
  return `${localDateKey(date, timezone)} ${time}`;
}

function speakOption(option: AgentSlotOption, timezone: string): string {
  const weekday = option.start.toLocaleDateString('es-ES', { weekday: 'long', timeZone: timezone });
  const day = option.start.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    timeZone: timezone,
  });
  const time = speakClockTime(option.start, timezone);
  return `${weekday} ${day} ${clockArticle(time)} ${time} con ${option.professionalName} [start_time=${localSlotKey(option.start, timezone)} professional_id=${option.professionalId}]`;
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
    // Primera visita: quien ya tiene historia (cita o nota clínica) nunca lo
    // es. Con patient_id se mira esa ficha; si no, lo que diga el agente; y si
    // no dice nada, el historial del teléfono. Un fallo al mirarlo no deja sin
    // huecos: se asume conocido y al reservar se vuelve a comprobar.
    let returning = false;
    let firstVisit = false;
    if (args.patient_id && isUuid(args.patient_id)) {
      returning = await patientHasHistory(tenantId, { patientId: args.patient_id }).catch(
        () => true,
      );
      firstVisit = !returning;
    } else if (typeof args.first_visit === 'boolean') {
      firstVisit = args.first_visit;
      returning = !args.first_visit;
    } else if (ctx.patientPhone) {
      returning = await phoneHasHistory(tenantId, ctx.patientPhone).catch(() => true);
      firstVisit = !returning;
    }

    const search = await findAgentSlots(tenantId, {
      treatmentName: args.treatment_name ?? null,
      professionalName: args.professional_name ?? null,
      preferredDate: args.preferred_date ?? null,
      // Dos semanas enteras: hace falta el día completo para poder ofrecer
      // todos sus huecos, no sólo los tres primeros de la semana.
      days: 14,
      limitPerProfessional: 400,
      firstVisit,
      returning,
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

    // Primero tres (por chat o teléfono no se retienen más). Si ninguna le
    // sirve, TODOS los huecos de ese día; si tampoco, los del siguiente día
    // con huecos. Todo ya filtrado por la jornada de cada profesional y por el
    // horario de atención de la clínica.
    const dayKey = (o: AgentSlotOption) => localDateKey(o.start, search.timezone);
    const days = [...new Set(search.options.map(dayKey))];
    const [firstDay, secondDay] = days;
    const picked = diversifyByProfessional(search.options, 3);
    const spoken = picked.map((o) => speakOption(o, search.timezone));
    const tratamiento = search.matchedTreatment ? ` para ${search.matchedTreatment.name}` : '';
    const dayLabel = (key: string) => {
      const sample = search.options.find((o) => dayKey(o) === key);
      return sample
        ? sample.start.toLocaleDateString('es-ES', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            timeZone: search.timezone,
          })
        : key;
    };
    const listDay = (key: string) =>
      search.options
        .filter((o) => dayKey(o) === key)
        .map(
          (o) =>
            `${speakClockTime(o.start, search.timezone)} con ${o.professionalName} [start_time=${localSlotKey(o.start, search.timezone)} professional_id=${o.professionalId}]`,
        )
        .join('; ');

    const requested = args.preferred_date?.trim();
    const noneOnRequested =
      requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && firstDay !== requested
        ? `El día que pidió (${requested}) no hay huecos libres (o la clínica no atiende ese día): díselo y ofrécele lo siguiente. `
        : '';

    const varios =
      !search.matchedProfessional && search.offeredBy.length > 1
        ? ` Varios profesionales atienden este tratamiento: ${search.offeredBy
            .map((p) => p.fullName)
            .join(
              ', ',
            )}. Si el paciente no dijo con quién, preguntale si tiene preferencia; si le da igual, ofrecele el hueco más próximo.`
        : '';

    const fullDays = [
      firstDay ? `Todos los huecos libres del ${dayLabel(firstDay)}: ${listDay(firstDay)}.` : '',
      secondDay
        ? `Si ese día no le va, todos los del siguiente día con huecos, ${dayLabel(secondDay)}: ${listDay(secondDay)}.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');

    const relaxNote = search.relaxedConsecutive
      ? 'Aviso: no queda ningún hueco que no vaya pegado a otra primera visita, así que se ofrecen estos (está permitido sólo porque no hay otra opción). '
      : '';
    return {
      result: `${noneOnRequested}${relaxNote}OFRECE PRIMERO estas tres opciones${tratamiento}: ${spoken.join('; ')}. Si ninguna le sirve, NO digas que no hay hueco: ofrécele todas las horas libres de ese día; y si tampoco, las del día siguiente con huecos. ${fullDays}${varios} Sólo existen los huecos de esta lista: no inventes horas ni ofrezcas otras (ya respetan el horario de la clínica). Para otra fecha, vuelve a llamar a check_availability con preferred_date. Para reservar, el paciente tiene que ELEGIR un hueco concreto (día, hora Y profesional): un "sí" o "dale" ambiguo NO es una elección. Luego pasá a book_appointment el start_time y el professional_id EXACTOS de ESE hueco, copiados tal cual de los corchetes (start_time es la hora de la clínica, NO la conviertas ni le añadas zona). Al paciente decile sólo el día, la hora y el nombre del profesional.`,
    };
  } catch (err) {
    console.error('[agenda-voice] check_availability', err);
    // No `null`: eso caía al CRM y el agente decía "la clínica no tiene la
    // agenda configurada", que es falso. Un fallo puntual se reintenta.
    return {
      result:
        'No pude consultar la agenda en este momento. Vuelve a llamar a check_availability una vez; si vuelve a fallar, dile al paciente que recepción le confirma la hora y usa request_handoff.',
    };
  }
}

/**
 * ¿La cita que se va a reservar es primera visita? Lo mismo que decide
 * check_availability, para que se valide contra los mismos huecos que se
 * ofrecieron: el tratamiento manda; si no dice, el historial del paciente (o
 * del teléfono).
 */
async function bookingIsFirstVisit(
  tenantId: string,
  input: { treatmentId: string | null; patientId: string | null; phone: string | null },
): Promise<boolean> {
  let byTreatment: boolean | null = null;
  if (input.treatmentId) {
    const [row] = await db
      .select({ visitKind: treatments.visitKind })
      .from(treatments)
      .where(and(eq(treatments.tenantId, tenantId), eq(treatments.id, input.treatmentId)))
      .limit(1);
    byTreatment = firstVisitFromTreatment(row?.visitKind);
  }
  const hasHistory = input.patientId
    ? await patientHasHistory(tenantId, { patientId: input.patientId })
    : input.phone
      ? await phoneHasHistory(tenantId, input.phone).catch(() => true)
      : true;
  return decideFirstVisit(hasHistory, byTreatment);
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

    // La hora se comprueba contra los huecos libres REALES de ese día, con las
    // mismas reglas que al ofrecerlos. El modelo reescribe el start_time (pone
    // la hora local con Z y la cita salía una hora corrida, o decía "ocupado"
    // de un hueco libre): aquí se elige la lectura que coincide con un hueco.
    const timezone = await getClinicTimezone(tenantId);
    const duration = treatment?.durationMinutes ?? 30;
    const firstVisit = await bookingIsFirstVisit(tenantId, {
      treatmentId: treatment?.id ?? null,
      patientId,
      phone: args.phone ?? null,
    });
    const [settings] = await db
      .select({ workingHours: clinicSettings.workingHours })
      .from(clinicSettings)
      .where(eq(clinicSettings.tenantId, tenantId))
      .limit(1);
    const freeBetween = async (fromKey: string, toKey: string, relax: boolean) => {
      const availability = await getAvailability(tenantId, {
        professionalId: professional.id,
        fromDateKey: fromKey,
        toDateKey: toKey,
        durationMinutes: duration,
        limit: 400,
        firstVisit,
        relaxConsecutiveFirstVisits: relax,
      });
      return availability.slots
        .map((sl) => ({ start: sl.start, end: sl.end }))
        .filter((sl) => withinClinicHours(sl.start, sl.end, timezone, settings?.workingHours));
    };
    const probe = matchRequestedSlot(args.start_time, timezone, []);
    if (!probe.dayKey) {
      return {
        result:
          'No entiendo esa hora. Pasa en start_time el hueco exacto que devolvió check_availability (por ejemplo "2026-11-03 16:00").',
      };
    }
    const dayKey = probe.dayKey;
    const free = await freeBetween(addDaysToKey(dayKey, -1), addDaysToKey(dayKey, 1), false);
    let chosen = matchRequestedSlot(
      args.start_time,
      timezone,
      free.map((f) => f.start),
    ).start;
    // Pegada a otra primera visita: sólo si de ahí en adelante no queda ningún
    // otro hueco en dos semanas (es lo que hace check_availability al ofrecer).
    let relaxConsecutive = false;
    if (!chosen && firstVisit) {
      const ahead = await freeBetween(dayKey, addDaysToKey(dayKey, 14), false);
      if (ahead.length === 0) {
        const relaxed = await freeBetween(addDaysToKey(dayKey, -1), addDaysToKey(dayKey, 1), true);
        chosen = matchRequestedSlot(
          args.start_time,
          timezone,
          relaxed.map((f) => f.start),
        ).start;
        relaxConsecutive = chosen !== null;
      }
    }
    if (!chosen) {
      const sameDay = free.filter((f) => localDateKey(f.start, timezone) === dayKey);
      const lista = sameDay.map((f) => speakClockTime(f.start, timezone)).join(', ');
      return {
        result: sameDay.length
          ? `Esa hora no está libre con ${professional.fullName}. Ese día (${dayKey}) sí quedan: ${lista}. Ofrécele una de esas (start_time "${dayKey} HH:MM") y no le digas otra.`
          : `Ese día (${dayKey}) ${professional.fullName} no tiene ningún hueco libre. Llama a check_availability con preferred_date del día siguiente y ofrécele lo que devuelva.`,
      };
    }

    const { appointment, deduped } = await createAppointment(systemAgendaContext(tenantId), {
      professionalId: professional.id,
      treatmentId: treatment?.id ?? null,
      patientId,
      patientName,
      // Normalizado aquí: un teléfono mal dictado no puede tumbar la reserva.
      patientPhone: normalizePatientPhone(args.phone) ?? '',
      patientEmail: args.email ?? '',
      ghlContactId: args.contact_id ?? '',
      startsAt: chosen.toISOString(),
      durationMinutes: treatment?.durationMinutes,
      relaxConsecutiveFirstVisits: relaxConsecutive,
      notes: args.notes ?? '',
      source: args.source ?? 'VOICE_AGENT',
      dedupeKey: args.dedupe_key,
    });

    const cuando = `${appointment.startsAt.toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: timezone,
    })} a las ${appointment.startsAt.toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    })}`;

    return {
      result: deduped
        ? `Esa cita ya estaba agendada (${cuando} con ${professional.fullName}). No se duplicó.`
        : `Cita agendada: ${cuando} con ${professional.fullName}. Confírmale al paciente EXACTAMENTE ese día y esa hora (no otra) y el profesional.`,
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

/**
 * Anular una cita sin que el paciente tenga que dar un id: se buscan las citas
 * próximas del teléfono del canal y se eligen por el nombre y el día que diga.
 * Una sola → se anula. Varias → se devuelven para que el agente pregunte cuál
 * (por nombre o por día, nunca por id). Ninguna → se dice.
 *
 * Sólo el teléfono del canal: un nombre no basta para anular una cita, porque
 * cualquiera podría anular la de otro.
 */
export async function agendaCancelByPatient(
  tenantId: string,
  args: { patient_name?: string | null; date?: string | null },
  ctx: { patientPhone?: string | null },
  cancelledBy: CancelledBy = 'PATIENT',
): Promise<AgendaToolResult> {
  if (!(await usesInternalAgenda(tenantId))) return null;

  const phone = normalizePatientPhone(ctx.patientPhone);
  if (!phone) {
    return {
      result:
        'No puedo localizar la cita sin el teléfono desde el que escribe o llama el paciente. Deriva a recepción con request_handoff.',
    };
  }

  try {
    const timezone = await getClinicTimezone(tenantId);
    const rows = await db
      .select({
        id: agendaAppointments.id,
        patientName: agendaAppointments.patientName,
        startsAt: agendaAppointments.startsAt,
        professionalName: professionals.fullName,
      })
      .from(agendaAppointments)
      .innerJoin(professionals, eq(professionals.id, agendaAppointments.professionalId))
      .where(
        and(
          eq(agendaAppointments.tenantId, tenantId),
          eq(agendaAppointments.patientPhone, phone),
          inArray(agendaAppointments.status, ['SCHEDULED', 'CONFIRMED']),
          gte(agendaAppointments.startsAt, new Date()),
        ),
      )
      .orderBy(asc(agendaAppointments.startsAt))
      .limit(20);

    const describe = (a: (typeof rows)[number]) =>
      `${a.patientName}, el ${localDateKey(a.startsAt, timezone)} ${speakClockTime(a.startsAt, timezone)} con ${a.professionalName}`;

    if (rows.length === 0) {
      return {
        result:
          'Este teléfono no tiene ninguna cita próxima en la agenda. Pregúntale si la cita está a nombre de otra persona o desde qué número la pidió; si no se aclara, deriva a recepción con request_handoff.',
      };
    }

    const matches = pickAppointmentsToCancel(rows, {
      patientName: args.patient_name,
      dateKey: args.date,
      timezone,
    });

    if (matches.length !== 1) {
      const list = (matches.length > 0 ? matches : rows).map(describe).join('; ');
      return {
        result: `Hay varias citas próximas con este teléfono: ${list}. Pregúntale cuál quiere cancelar por el nombre del paciente o el día (nunca le pidas un id) y vuelve a llamar a cancel_appointment con patient_name y date.`,
      };
    }

    const target = matches[0];
    if (!target) return null;
    await cancelAppointment(
      systemAgendaContext(tenantId),
      target.id,
      'Cancelada por el agente',
      cancelledBy,
    );
    return {
      result: `Cita cancelada: ${describe(target)}. El hueco vuelve a estar libre. Confírmaselo al paciente y pregúntale si quiere otra fecha.`,
    };
  } catch (err) {
    console.error('[agenda-voice] cancel_appointment por paciente', err);
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
          ? p.treatments.map((t) => t.name).join(', ')
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
