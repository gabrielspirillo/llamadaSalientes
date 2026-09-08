import 'server-only';
import { normalizePatientPhone } from '@/lib/agenda/patients';
import {
  agendaBookAppointment,
  agendaCancelAppointment,
  agendaCheckAvailability,
  agendaListProfessionals,
  agendaPatientSummary,
} from '@/lib/agenda/voice';
import { upsertAppointmentCache } from '@/lib/appointments/cache';
import { patchCallCustomData, setCallGhlContact } from '@/lib/data/calls';
import { listFaqsForTenant } from '@/lib/data/faqs';
import { getGhlIntegration } from '@/lib/data/ghl-integration';
import { listTreatmentsForTenant } from '@/lib/data/treatments';
import { getFreeSlots, resolveCalendarId } from '@/lib/ghl/calendars';
import { GhlApiError, ghlFetch } from '@/lib/ghl/client';
import { createContact, lookupContactByPhone, updateContact } from '@/lib/ghl/contacts-mutations';
import { embedText } from '@/lib/openai/client';
import {
  describePatient,
  findPatientByPhone,
  setPatientEmail,
  upsertPatientRecord,
} from '@/lib/patients/registry';
import { cosineSimilarity } from '@/lib/rag/cosine';
import { clockArticle, speakClockTime } from '@/lib/retell/time-speech';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToolResult = { result: string };

// Args tipados por tool
export type CheckAvailabilityArgs = {
  treatment_name: string;
  preferred_date: string; // ISO date "YYYY-MM-DD"
  calendar_id?: string;
  /** Agenda interna: el paciente pidió un profesional concreto. */
  professional_name?: string;
};

export type BookAppointmentArgs = {
  contact_id?: string; // si no se pasa, lo resolvemos por phone
  phone?: string;
  calendar_id?: string; // opcional, auto-resuelve por treatment_name
  start_time: string; // ISO datetime
  treatment_name: string;
  /** Agenda interna: id que devolvió check_availability entre corchetes. */
  professional_id?: string;
  professional_name?: string;
  /** Agenda interna: la cita se deja a nombre del paciente. */
  patient_name?: string;
  email?: string;
};

export type CancelAppointmentArgs = {
  appointment_id: string;
};

export type GetPatientInfoArgs = {
  phone: string;
};

export type RegisterPatientArgs = {
  first_name: string;
  last_name?: string;
  phone: string;
  email?: string;
};

export type AcceptWaitlistOfferArgs = {
  offer_id: string;
};

export type DeclineWaitlistOfferArgs = {
  offer_id: string;
};

// ─── GHL response shapes (mínimos) ───────────────────────────────────────────

type GhlSlot = { startTime: string; endTime: string };
type GhlAppointment = {
  id: string;
  contactId?: string;
  calendarId?: string;
  appointmentStatus?: string;
  assignedUserId?: string;
  title?: string;
  startTime?: string;
  endTime?: string;
};

// Heurística: GHL contact IDs son alfanuméricos de 20 chars sin espacios
// (ej. W5CUSlYRHfeubqP8j29P). Si el agente nos pasa basura ("Gabriel/+542..."),
// la rechazamos y caemos al lookup por teléfono.
function looksLikeGhlId(s: string | undefined | null): boolean {
  if (!s) return false;
  return /^[A-Za-z0-9]{15,30}$/.test(s);
}

// lookupContactByPhone + createContact se importan desde @/lib/ghl/contacts-mutations
// para evitar duplicación con triggerCallback.

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Ni agenda propia ni CRM: no hay dónde mirar horarios ni dónde escribir la
 * cita.
 *
 * No es lo mismo que "no hay CRM", que es lo que decía antes este mensaje. Una
 * clínica sin CRM pero con la agenda de la plataforma encendida funciona
 * entera; aquí sólo se llega cuando no tiene ninguna de las dos, que es un
 * problema de configuración y no algo que el paciente deba oír. Al agente se le
 * dice qué hacer en su lugar.
 */
function noAgendaBackend(): ToolResult {
  return {
    result:
      'La clínica todavía no tiene su agenda configurada en la plataforma, así que no puedo consultar horarios ni reservar. Tomá el nombre y el teléfono del paciente y decile que recepción le confirma la cita.',
  };
}

/** El teléfono del paciente: el que diga el agente y, si no, el que sabe el canal. */
function resolvePatientPhone(raw: string | null | undefined, ctx: ToolContext): string | null {
  return normalizePatientPhone(raw) ?? normalizePatientPhone(ctx.patientPhone) ?? null;
}

function formatSlots(slots: GhlSlot[]): string {
  if (slots.length === 0)
    return 'No hay disponibilidad en esa fecha. Proponé al paciente otra fecha.';
  const tz = 'Europe/Madrid';
  const formatted = slots
    .slice(0, 4)
    .map((s) => {
      const d = new Date(s.startTime);
      const weekday = d.toLocaleDateString('es-ES', { weekday: 'long', timeZone: tz });
      const time = speakClockTime(d, tz);
      // Anexamos el start_time EXACTO (ISO con zona) entre corchetes. El agente
      // debe pasarlo VERBATIM a book_appointment: si lo "adivina" a partir del
      // texto hablado pierde la zona horaria y GHL rechaza la reserva con
      // "slot no longer available". No lo digas en voz alta al paciente: es dato
      // interno; al paciente le dices solo el día y la hora.
      return `${weekday} ${clockArticle(time)} ${time} [start_time=${s.startTime}]`;
    })
    .join('; ');
  return `Horarios disponibles: ${formatted}. Para reservar, pasá a book_appointment el valor exacto de start_time (entre corchetes) del hueco que elija el paciente, sin modificarlo ni recalcular la hora.`;
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

export async function checkAvailability(
  tenantId: string,
  args: CheckAvailabilityArgs,
): Promise<ToolResult> {
  // La agenda de la plataforma manda cuando la clínica la usa. Si no hay
  // ningún profesional con la agenda encendida, `agendaCheckAvailability`
  // devuelve null y seguimos por GoHighLevel como siempre.
  const internal = await agendaCheckAvailability(tenantId, {
    treatment_name: args.treatment_name,
    preferred_date: args.preferred_date,
    professional_name: args.professional_name,
  });
  if (internal) return internal;

  const integration = await getGhlIntegration(tenantId);
  if (!integration) return noAgendaBackend();

  try {
    const resolved = await resolveCalendarId(tenantId, {
      explicitCalendarId: args.calendar_id ?? null,
      treatmentName: args.treatment_name,
    });

    console.log('[check_availability]', {
      tenantId,
      treatment: args.treatment_name,
      preferred_date: args.preferred_date,
      resolved,
    });

    if (!resolved.calendarId) {
      return {
        result:
          'La clínica todavía no tiene calendarios configurados en su CRM. Tomá nota del nombre y teléfono del paciente para que recepción lo contacte y agende manualmente.',
      };
    }

    // Parser de fecha tolerante: acepta YYYY-MM-DD o ISO completo.
    let day = new Date(args.preferred_date);
    if (Number.isNaN(day.getTime())) {
      console.warn(
        '[check_availability] preferred_date inválido, asumo mañana:',
        args.preferred_date,
      );
      day = new Date();
      day.setDate(day.getDate() + 1);
    }
    day.setUTCHours(0, 0, 0, 0);

    // Validación crítica: el LLM a veces alucina años (ej. 2024 cuando es 2026).
    // Si la fecha es del pasado, devolvemos mensaje explícito con la fecha actual
    // para que el agente recalcule en su próximo turno.
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    if (day.getTime() < now.getTime()) {
      const todayStr = now.toISOString().slice(0, 10);
      console.warn(
        '[check_availability] fecha en el pasado:',
        args.preferred_date,
        '(hoy es',
        todayStr,
        ')',
      );
      return {
        result: `Esa fecha (${args.preferred_date}) ya pasó. Hoy es ${todayStr}. Recalculá la fecha correcta del año actual y volvé a llamar al tool con preferred_date en formato YYYY-MM-DD.`,
      };
    }

    const next = new Date(day);
    next.setUTCDate(next.getUTCDate() + 1);

    const slots = await getFreeSlots(tenantId, resolved.calendarId, {
      startDateMs: day.getTime(),
      endDateMs: next.getTime(),
    });

    console.log('[check_availability] slots devueltos:', slots.length);

    return { result: formatSlots(slots) };
  } catch (err) {
    console.error('[check_availability] error:', err);
    if (err instanceof GhlApiError) {
      return {
        result: `No pude consultar el calendario (error ${err.status}). Tomá nombre y teléfono y avisá que recepción confirma en breve.`,
      };
    }
    throw err;
  }
}

export async function bookAppointment(
  tenantId: string,
  args: BookAppointmentArgs,
  ctx: ToolContext = {},
): Promise<ToolResult> {
  // Idem: si la clínica lleva su agenda en la plataforma, la cita se crea ahí.
  // El dedupe_key sale de la llamada: un reintento del webhook no puede dejar
  // dos citas al mismo paciente.
  // El LLM omite el teléfono a menudo aunque lo tenga delante. Lo sabemos por
  // el canal (quien llama, o el WhatsApp desde el que escribe), y sin él la
  // cita se guardaría sin identidad de paciente y sin destino al que mandarle
  // el recordatorio.
  const phone = resolvePatientPhone(args.phone, ctx);
  const crmContactId = looksLikeGhlId(args.contact_id) ? args.contact_id : undefined;

  // La agenda deja la cita a nombre del paciente y lo exige. Si el modelo no
  // lo pasa, se coge de su ficha en vez de rechazar la reserva: el nombre
  // guardado es más fiable que uno que el modelo se invente para salir del
  // paso.
  let patientName = args.patient_name?.trim() || '';
  if (!patientName && phone) {
    const known = await findPatientByPhone(tenantId, phone).catch(() => null);
    if (known) patientName = describePatient(known);
  }

  const internal = await agendaBookAppointment(tenantId, {
    start_time: args.start_time,
    professional_id: args.professional_id,
    professional_name: args.professional_name,
    treatment_name: args.treatment_name,
    patient_name: patientName || undefined,
    phone: phone ?? undefined,
    email: args.email,
    contact_id: crmContactId,
    source: ctx.channel === 'WHATSAPP' ? 'WHATSAPP_AGENT' : 'VOICE_AGENT',
    dedupe_key:
      ctx.dedupeKey ??
      (ctx.retellCallId ? `call:${ctx.retellCallId}:${args.start_time}` : undefined),
  });
  if (internal) {
    // La cita ya está hecha: que el paciente quede además en la libreta es
    // best-effort y nunca tumba una reserva confirmada.
    await upsertPatientRecord({
      tenantId,
      phone,
      fullName: patientName || null,
      email: args.email,
      ghlContactId: crmContactId,
    }).catch((err) => console.warn('[book_appointment] ficha del paciente', err));
    return internal;
  }

  const integration = await getGhlIntegration(tenantId);
  if (!integration) return noAgendaBackend();

  console.log('[book_appointment] args:', {
    contact_id: args.contact_id,
    phone: args.phone,
    calendar_id: args.calendar_id,
    start_time: args.start_time,
    treatment_name: args.treatment_name,
  });

  try {
    // 1. Resolver calendar
    const resolved = await resolveCalendarId(tenantId, {
      explicitCalendarId: looksLikeGhlId(args.calendar_id) ? args.calendar_id : null,
      treatmentName: args.treatment_name,
    });
    if (!resolved.calendarId) {
      return {
        result:
          'No puedo agendar porque la clínica no tiene calendarios configurados. Tomá nombre y teléfono — recepción confirma manualmente.',
      };
    }

    // 2. Resolver contactId. Si el agente nos pasa basura, intentar lookup por phone.
    const rawContactId = args.contact_id;
    let contactId: string | null =
      rawContactId && looksLikeGhlId(rawContactId) ? rawContactId : null;
    if (!contactId && args.phone) {
      const found = await lookupContactByPhone(tenantId, args.phone);
      if (found) contactId = found.id;
    }
    if (!contactId) {
      return {
        result:
          'Para agendar necesito el contact_id real del paciente. Llamá primero a get_patient_info(phone) para encontrarlo, o si es nuevo a register_patient(first_name, last_name, phone) para crearlo, y usá el id que te devuelva.',
      };
    }

    // 3. Validar formato de start_time (debe ser ISO con timezone)
    const startDate = new Date(args.start_time);
    if (Number.isNaN(startDate.getTime())) {
      return {
        result: `start_time inválido: "${args.start_time}". Debe ser ISO 8601 (ej: 2026-05-11T09:00:00).`,
      };
    }

    // 4. Crear la cita
    const appointment = await ghlFetch<GhlAppointment>({
      tenantId,
      path: '/calendars/events/appointments',
      method: 'POST',
      body: {
        calendarId: resolved.calendarId,
        locationId: integration.locationId,
        contactId,
        startTime: startDate.toISOString(),
        title: args.treatment_name,
      },
    });

    console.log('[book_appointment] ok:', appointment.id);

    // Persistir en cache local para que el inbox/contact detail muestre la
    // cita al instante, sin esperar al webhook AppointmentCreate. Idempotente
    // por (tenant_id, ghl_appointment_id).
    await upsertAppointmentCache({
      tenantId,
      appt: {
        id: appointment.id,
        contactId: appointment.contactId ?? contactId,
        calendarId: appointment.calendarId ?? resolved.calendarId,
        appointmentStatus: appointment.appointmentStatus ?? 'confirmed',
        assignedUserId: appointment.assignedUserId ?? null,
        title: appointment.title ?? args.treatment_name,
        startTime: appointment.startTime ?? startDate.toISOString(),
        endTime: appointment.endTime ?? null,
      },
    }).catch((err) => {
      // No rompemos el booking por un fallo de cache: el webhook va a
      // upsertear cuando GHL nos avise.
      console.warn('[book_appointment] cache upsert failed', err);
    });

    // Enriquecer fila call: marcar intent=agendar, ghlContactId, appointmentId
    if (ctx.retellCallId) {
      await setCallGhlContact(ctx.retellCallId, contactId).catch(() => undefined);
      await patchCallCustomData(ctx.retellCallId, {
        ghl_appointment_id: appointment.id,
        treatment_name: args.treatment_name,
        appointment_start: startDate.toISOString(),
      }).catch(() => undefined);
    }

    return {
      result: 'Cita agendada correctamente. El paciente va a recibir confirmación.',
    };
  } catch (err) {
    console.error('[book_appointment]', err);
    if (err instanceof GhlApiError) {
      return {
        result: `No pude agendar (error ${err.status}). ${err.body.slice(0, 100)}`,
      };
    }
    throw err;
  }
}

/**
 * Da de alta al paciente.
 *
 * La ficha se crea SIEMPRE en la plataforma, haya CRM o no. Antes esta era la
 * única tool del conjunto sin camino propio: iba directa al CRM y, sin él,
 * respondía "el CRM no está conectado". El agente lo leía como herramienta
 * fallida y, por la regla de honestidad del prompt, derivaba a recepción — con
 * lo que una clínica que tiene su agenda en la plataforma no podía dar una
 * cita a un paciente nuevo.
 */
export async function registerPatient(
  tenantId: string,
  args: RegisterPatientArgs,
  ctx: ToolContext = {},
): Promise<ToolResult> {
  if (!args.first_name?.trim()) {
    return { result: 'Para registrar al paciente necesito al menos su nombre.' };
  }
  const phone = resolvePatientPhone(args.phone, ctx);
  if (!phone) {
    return {
      result:
        'Para registrar al paciente necesito su teléfono en formato internacional, por ejemplo +34600111222.',
    };
  }
  const fullName = [args.first_name, args.last_name]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(' ');

  const record = await upsertPatientRecord({
    tenantId,
    phone,
    firstName: args.first_name,
    lastName: args.last_name,
    email: args.email,
  }).catch((err) => {
    console.error('[register_patient] no se pudo guardar la ficha', err);
    return null;
  });

  if (ctx.retellCallId && fullName) {
    await patchCallCustomData(ctx.retellCallId, { patient_name: fullName }).catch(() => undefined);
  }

  const integration = await getGhlIntegration(tenantId);
  if (!integration) {
    if (!record) {
      return {
        result:
          'No pude guardar la ficha del paciente. Tomá su nombre y teléfono y decile que recepción le confirma.',
      };
    }
    // Sin CRM no hay contact_id que devolver, y la agenda de la plataforma no
    // lo necesita. Decírselo explícito evita que el agente se quede esperando
    // un id que no va a llegar.
    return {
      result: `Paciente ${fullName} dado de alta en la clínica con el teléfono ${phone}. No hace falta contact_id: para reservar llamá a book_appointment con patient_name y el professional_id del hueco elegido.`,
    };
  }

  // Si ya existe, devolver el contact_id existente
  const existing = await lookupContactByPhone(tenantId, phone);
  if (existing) {
    const name = [existing.firstName, existing.lastName].filter(Boolean).join(' ');
    // Enlazar la ficha local con el CRM: es lo que hace que las citas de los
    // dos orígenes queden bajo la misma identidad de paciente.
    await upsertPatientRecord({ tenantId, phone, ghlContactId: existing.id }).catch(
      () => undefined,
    );
    if (ctx.retellCallId) {
      await setCallGhlContact(ctx.retellCallId, existing.id, name || args.first_name).catch(
        () => undefined,
      );
    }
    return {
      result: `Ya existe un paciente con ese teléfono: ${name || 'sin nombre'}. contact_id=${existing.id}. Usá ese id para agendar.`,
    };
  }

  const created = await createContact(tenantId, {
    firstName: args.first_name,
    lastName: args.last_name,
    phone,
    email: args.email,
  });
  if (!created) {
    // El CRM falló, pero la ficha de la plataforma ya está guardada y la
    // agenda propia no necesita el id: la cita se puede dar igual.
    return {
      result: record
        ? `Paciente ${fullName} dado de alta en la clínica. No pude crearlo en el CRM, así que reservá con book_appointment usando patient_name y el professional_id del hueco, sin contact_id.`
        : 'No pude crear al paciente. Tomá nombre y teléfono y decile que recepción le confirma.',
    };
  }

  await upsertPatientRecord({ tenantId, phone, ghlContactId: created.id }).catch(() => undefined);

  // Enriquecer la fila de la llamada
  if (ctx.retellCallId) {
    await setCallGhlContact(ctx.retellCallId, created.id, fullName).catch(() => undefined);
  }

  return {
    result: `Paciente creado correctamente. contact_id=${created.id}. Usá ese id para llamar a book_appointment.`,
  };
}

export async function cancelAppointment(
  tenantId: string,
  args: CancelAppointmentArgs,
): Promise<ToolResult> {
  const internal = await agendaCancelAppointment(tenantId, args.appointment_id);
  if (internal) return internal;

  const integration = await getGhlIntegration(tenantId);
  if (!integration) return noAgendaBackend();

  try {
    await ghlFetch({
      tenantId,
      path: `/calendars/events/appointments/${args.appointment_id}`,
      method: 'DELETE',
    });

    return { result: 'La cita fue cancelada correctamente.' };
  } catch (err) {
    if (err instanceof GhlApiError && err.status === 404) {
      return {
        result: 'No encontré esa cita. Puede que ya haya sido cancelada o el ID sea incorrecto.',
      };
    }
    if (err instanceof GhlApiError) {
      return {
        result: 'No pude cancelar la cita en este momento. Por favor comunícate con la clínica.',
      };
    }
    throw err;
  }
}

export async function getPatientInfo(
  tenantId: string,
  args: GetPatientInfoArgs,
  ctx: ToolContext = {},
): Promise<ToolResult> {
  const phone = resolvePatientPhone(args.phone, ctx);
  if (!phone) {
    return {
      result:
        'Necesito el teléfono del paciente en formato internacional (por ejemplo +34600111222) para buscar su ficha.',
    };
  }

  // Lo que la agenda interna sabe de este teléfono: próxima cita, última
  // visita y lo que dejó anotado el profesional. Sirve aunque no haya CRM.
  const agenda = await agendaPatientSummary(tenantId, { phone });
  const record = await findPatientByPhone(tenantId, phone).catch((err) => {
    console.warn('[get_patient_info] ficha local', err);
    return null;
  });

  const integration = await getGhlIntegration(tenantId);
  if (!integration) {
    // Sin CRM la ficha de la plataforma es la única fuente, y basta: la agenda
    // reserva con el nombre del paciente, no con un id del CRM. Antes esto
    // devolvía "el CRM no está conectado" y el agente derivaba a recepción.
    const partes: string[] = [];
    partes.push(
      record
        ? `Paciente conocido: ${describePatient(record)}.`
        : 'No tengo ficha de ese teléfono, así que es un paciente nuevo: pedile nombre y apellido y registralo con register_patient.',
    );
    if (agenda) partes.push(agenda);
    partes.push(
      'Para reservar NO hace falta contact_id: llamá a book_appointment con patient_name y el professional_id del hueco que elija.',
    );
    return { result: partes.join(' ') };
  }

  try {
    const contact = await lookupContactByPhone(tenantId, phone);
    if (!contact) {
      return {
        result: agenda
          ? `${agenda} No está en el CRM: si hace falta, creálo con register_patient.`
          : 'No encontré al paciente en el sistema. Es un paciente nuevo: pediles nombre y apellido y luego usá register_patient para crearlo antes de agendar.',
      };
    }
    const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Sin nombre';

    // El paciente del CRM también entra en la libreta de la plataforma: es lo
    // que enlaza su ficha local con el CRM y lo que deja el historial completo
    // si mañana se desconecta.
    await upsertPatientRecord({
      tenantId,
      phone,
      firstName: contact.firstName,
      lastName: contact.lastName,
      ghlContactId: contact.id,
    }).catch(() => undefined);

    // Enriquecer la fila de la llamada con info del contacto encontrado
    if (ctx.retellCallId) {
      await setCallGhlContact(ctx.retellCallId, contact.id, name).catch((e) =>
        console.error('[get_patient_info] enrich call failed:', e),
      );
    }

    return {
      result: `Paciente encontrado: ${name}. contact_id=${contact.id}. Usá ese contact_id para agendar la cita.${
        agenda ? ` ${agenda}` : ''
      }`,
    };
  } catch (err) {
    console.error('[get_patient_info]', err);
    if (err instanceof GhlApiError) {
      return { result: 'No pude buscar al paciente en este momento.' };
    }
    throw err;
  }
}

// ─── Tools de catálogo (clínica) ──────────────────────────────────────────────

export type GetTreatmentDetailsArgs = { name: string };
export type SearchFaqsArgs = { query: string };

function priceRange(
  min: string | number | null | undefined,
  max: string | number | null | undefined,
  currency: string | null | undefined,
): string {
  const cur = currency ?? 'EUR';
  const m = min != null ? String(min) : null;
  const M = max != null ? String(max) : null;
  if (m && M && m !== M) return `${cur} ${m}-${M}`;
  if (m) return `${cur} ${m}`;
  if (M) return `${cur} ${M}`;
  return 'consultar';
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

/**
 * Quién pasa consulta en la clínica y qué hace cada uno.
 *
 * Sólo tiene sentido con la agenda interna encendida: sin ella la clínica no
 * tiene profesionales cargados y el agente no debe inventarse ninguno.
 */
export async function listProfessionals(tenantId: string): Promise<ToolResult> {
  const internal = await agendaListProfessionals(tenantId);
  if (internal) return internal;
  return {
    result:
      'Esta clínica todavía no tiene agendas de profesionales en la plataforma. No menciones nombres de profesionales: ofrecé cita sin especificar quién atiende.',
  };
}

export async function listTreatments(tenantId: string): Promise<ToolResult> {
  const rows = await listTreatmentsForTenant(tenantId);
  const active = rows.filter((t) => t.active);
  if (active.length === 0) {
    return { result: 'No hay tratamientos cargados en el catálogo de la clínica.' };
  }
  const lines = active
    .slice(0, 30)
    .map(
      (t) =>
        `- ${t.name} (${t.durationMinutes} min, ${priceRange(t.priceMin, t.priceMax, t.currency)})`,
    );
  return {
    result: `Tratamientos disponibles:\n${lines.join('\n')}`,
  };
}

export async function getTreatmentDetails(
  tenantId: string,
  args: GetTreatmentDetailsArgs,
): Promise<ToolResult> {
  if (!args.name?.trim()) {
    return { result: 'Necesito el nombre del tratamiento para buscar detalles.' };
  }
  const rows = await listTreatmentsForTenant(tenantId);
  const q = normalize(args.name);
  let match =
    rows.find((t) => normalize(t.name) === q) ??
    rows.find((t) => normalize(t.name).includes(q)) ??
    rows.find((t) => q.includes(normalize(t.name)));
  // RAG: si no matcheó por nombre, intentamos semántico (ej. "para los
  // dientes torcidos" → Ortodoncia). Best-effort, fallback al mensaje de abajo.
  if (!match) {
    try {
      const withEmb = rows.filter(
        (t) => t.active && Array.isArray(t.embedding) && t.embedding.length > 0,
      );
      if (withEmb.length > 0) {
        const qVec = await embedText(args.name);
        if (qVec.length > 0) {
          const best = withEmb
            .map((t) => ({ t, sim: cosineSimilarity(qVec, t.embedding as number[]) }))
            .sort((a, b) => b.sim - a.sim)[0];
          if (best && best.sim >= 0.35) match = best.t;
        }
      }
    } catch (err) {
      console.warn('[rag] getTreatmentDetails semántico falló', (err as Error).message);
    }
  }
  if (!match) {
    const names = rows
      .filter((t) => t.active)
      .slice(0, 5)
      .map((t) => t.name)
      .join(', ');
    return {
      result: `No encontré "${args.name}" en el catálogo. Los más comunes son: ${names || 'sin catálogo cargado'}.`,
    };
  }
  if (!match.active) {
    return {
      result: `El tratamiento "${match.name}" no está activo actualmente. Ofrecé otro o transferí a recepción.`,
    };
  }
  const desc = match.description?.trim() || 'sin descripción';
  return {
    result: `${match.name}: ${desc}. Duración aproximada: ${match.durationMinutes} minutos. Precio: ${priceRange(match.priceMin, match.priceMax, match.currency)}.`,
  };
}

// Fallback por keyword (cuando no hay embeddings o el semántico falla).
function keywordFaqMatch<
  T extends {
    question: string;
    answer: string;
    category?: string | null;
    priority?: number | null;
  },
>(rows: T[], query: string): T[] {
  const q = normalize(query);
  const terms = q.split(/\s+/).filter((t) => t.length >= 3);
  return rows
    .map((f) => {
      const hay = normalize(`${f.question} ${f.answer} ${f.category ?? ''}`);
      const hits = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
      return { f, score: hits };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || (b.f.priority ?? 0) - (a.f.priority ?? 0))
    .slice(0, 3)
    .map((s) => s.f);
}

const FAQ_SIM_THRESHOLD = 0.3;

export async function searchFaqs(tenantId: string, args: SearchFaqsArgs): Promise<ToolResult> {
  if (!args.query?.trim()) {
    return { result: 'Necesito una palabra clave para buscar en las FAQs.' };
  }
  const rows = await listFaqsForTenant(tenantId);

  // RAG: ranking semántico por coseno sobre las FAQs con embedding. Si falla
  // (OpenAI caído) o no hay embeddings, caemos a keyword. Escala mejor que el
  // keyword cuando hay muchas FAQs y capta sinónimos/parafraseos.
  let top: typeof rows = [];
  try {
    const withEmb = rows.filter((f) => Array.isArray(f.embedding) && f.embedding.length > 0);
    if (withEmb.length > 0) {
      const qVec = await embedText(args.query);
      if (qVec.length > 0) {
        top = withEmb
          .map((f) => ({ f, sim: cosineSimilarity(qVec, f.embedding as number[]) }))
          .sort((a, b) => b.sim - a.sim)
          .filter((s) => s.sim >= FAQ_SIM_THRESHOLD)
          .slice(0, 3)
          .map((s) => s.f);
      }
    }
  } catch (err) {
    console.warn('[rag] searchFaqs semántico falló, uso keyword', (err as Error).message);
  }

  if (top.length === 0) top = keywordFaqMatch(rows, args.query);

  if (top.length === 0) {
    return {
      result: `No encontré nada en las FAQs sobre "${args.query}". Si la información no está en la clínica, ofrecé tomar el dato y devolver llamada.`,
    };
  }
  const lines = top.map((f) => `P: ${f.question}\nR: ${f.answer}`);
  return { result: lines.join('\n\n') };
}

// ─── set_lead_email ──────────────────────────────────────────────────────────

export type SetLeadEmailArgs = {
  email: string;
  phone?: string;
};

export async function setLeadEmail(
  tenantId: string,
  args: SetLeadEmailArgs,
  ctx: ToolContext = {},
): Promise<ToolResult> {
  const email = args.email?.trim();
  if (!email) {
    return { result: 'Necesito el correo electrónico del lead.' };
  }
  const phone = resolvePatientPhone(args.phone, ctx);
  if (!phone) {
    return { result: 'Necesito el teléfono del lead para saber en qué ficha guardar el correo.' };
  }

  // El correo se guarda SIEMPRE en la ficha de la plataforma. Sin esto, una
  // clínica sin CRM le pedía el correo al paciente, le decía que lo guardaba y
  // no quedaba en ningún sitio.
  const record = await setPatientEmail(tenantId, phone, email).catch((err) => {
    console.error('[set_lead_email] no se pudo guardar en la ficha', err);
    return null;
  });

  if (ctx.retellCallId) {
    await patchCallCustomData(ctx.retellCallId, { lead_email: email }).catch(() => undefined);
  }

  const integration = await getGhlIntegration(tenantId);
  if (!integration) {
    return {
      result: record
        ? `Correo ${email} guardado en la ficha del paciente.`
        : 'No pude guardar el correo. Tomá nota para cargarlo a mano.',
    };
  }

  try {
    const contact = await lookupContactByPhone(tenantId, phone);
    if (!contact) {
      return {
        result: record
          ? `Correo ${email} guardado en la ficha del paciente. Todavía no está en el CRM: si hace falta, creálo con register_patient.`
          : 'No encontré al contacto. Usá register_patient primero con first_name, phone y email.',
      };
    }

    const updated = await updateContact(tenantId, contact.id, { email });
    if (!updated) {
      return {
        result: record
          ? `Correo ${email} guardado en la ficha del paciente. No pude copiarlo al CRM; recepción lo revisa.`
          : 'No pude guardar el correo. Tomá nota para cargarlo a mano.',
      };
    }

    console.log('[set_lead_email] ok:', { contactId: contact.id });
    return { result: `Correo ${email} guardado correctamente.` };
  } catch (err) {
    console.error('[set_lead_email]', err);
    if (err instanceof GhlApiError) {
      return {
        result: record
          ? `Correo ${email} guardado en la ficha del paciente. El CRM dio error ${err.status}; recepción lo revisa.`
          : `No pude guardar el correo (error ${err.status}). Tomá nota para cargarlo después.`,
      };
    }
    throw err;
  }
}

// ─── Waitlist tools ──────────────────────────────────────────────────────────

export async function acceptWaitlistOffer(
  tenantId: string,
  args: AcceptWaitlistOfferArgs,
): Promise<ToolResult> {
  if (!args.offer_id) return { result: 'Falta offer_id, no puedo confirmar la oferta.' };
  const { markOfferAccepted } = await import('@/lib/waitlist/engine');
  const res = await markOfferAccepted({ offerId: args.offer_id, via: 'voice_tool' });
  if (!res.ok) {
    if (res.reason === 'offer_not_found') {
      return { result: 'No encontré esa oferta. Puede que ya esté cerrada.' };
    }
    if (res.reason.startsWith('already_')) {
      return { result: 'Esa oferta ya fue procesada antes.' };
    }
    return { result: 'No pude confirmar la oferta ahora mismo. Disculpá, recepción te llama.' };
  }
  return {
    result: 'Listo, dejé tu nueva cita reservada y cancelé la anterior. Te llega confirmación.',
  };
}

export async function declineWaitlistOffer(
  tenantId: string,
  args: DeclineWaitlistOfferArgs,
): Promise<ToolResult> {
  if (!args.offer_id) return { result: 'Falta offer_id.' };
  const { markOfferDeclined } = await import('@/lib/waitlist/engine');
  const res = await markOfferDeclined({ offerId: args.offer_id, via: 'voice_tool' });
  // markOfferDeclined devuelve EnqueueResult — el ok=false significa "no había
  // siguiente en cola" (lo que NO es un error desde el paciente). Solo fallamos
  // si la oferta no existe o ya está cerrada.
  if (!res.ok && (res.reason === 'offer_not_found' || res.reason.startsWith('already_'))) {
    return { result: 'No encontré esa oferta.' };
  }
  return { result: 'Sin problema, dejamos tu cita original tal cual. Gracias por avisar.' };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export type KnownToolName =
  | 'check_availability'
  | 'book_appointment'
  | 'cancel_appointment'
  | 'get_patient_info'
  | 'register_patient'
  | 'set_lead_email'
  | 'list_treatments'
  | 'get_treatment_details'
  | 'search_faqs'
  | 'accept_waitlist_offer'
  | 'decline_waitlist_offer'
  | 'list_professionals';

export type ToolContext = {
  retellCallId?: string;
  /** Canal del agente. Decide el `source` de la cita en la agenda interna. */
  channel?: 'VOICE' | 'WHATSAPP';
  /** Clave de idempotencia del canal (conversación de WhatsApp, por ejemplo). */
  dedupeKey?: string;
  /**
   * Teléfono del paciente, ya normalizado, tal como lo sabe el canal: el
   * número desde el que llama o el WhatsApp desde el que escribe.
   *
   * El LLM se olvida de pasarlo la mitad de las veces, y sin teléfono la cita
   * queda sin forma de identificar al paciente (`patient_key` cae a su nombre)
   * y sin destino al que mandarle el recordatorio. Con esto ya no depende de
   * que el modelo se acuerde.
   */
  patientPhone?: string | null;
};

export async function dispatchTool(
  tenantId: string,
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext = {},
): Promise<ToolResult> {
  switch (toolName as KnownToolName) {
    case 'check_availability':
      return checkAvailability(tenantId, args as CheckAvailabilityArgs);
    case 'book_appointment':
      return bookAppointment(tenantId, args as BookAppointmentArgs, ctx);
    case 'cancel_appointment':
      return cancelAppointment(tenantId, args as CancelAppointmentArgs);
    case 'get_patient_info':
      return getPatientInfo(tenantId, args as GetPatientInfoArgs, ctx);
    case 'register_patient':
      return registerPatient(tenantId, args as RegisterPatientArgs, ctx);
    case 'set_lead_email':
      return setLeadEmail(tenantId, args as SetLeadEmailArgs, ctx);
    case 'list_treatments':
      return listTreatments(tenantId);
    case 'get_treatment_details':
      return getTreatmentDetails(tenantId, args as GetTreatmentDetailsArgs);
    case 'search_faqs':
      return searchFaqs(tenantId, args as SearchFaqsArgs);
    case 'accept_waitlist_offer':
      return acceptWaitlistOffer(tenantId, args as AcceptWaitlistOfferArgs);
    case 'decline_waitlist_offer':
      return declineWaitlistOffer(tenantId, args as DeclineWaitlistOfferArgs);
    case 'list_professionals':
      return listProfessionals(tenantId);
    default:
      return { result: `Tool desconocida: ${toolName}` };
  }
}
