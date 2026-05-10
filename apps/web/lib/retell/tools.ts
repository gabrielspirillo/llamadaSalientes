import 'server-only';
import { GhlApiError, ghlFetch } from '@/lib/ghl/client';
import { getFreeSlots, resolveCalendarId } from '@/lib/ghl/calendars';
import { patchCallCustomData, setCallGhlContact } from '@/lib/data/calls';
import { getGhlIntegration } from '@/lib/data/ghl-integration';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToolResult = { result: string };

// Args tipados por tool
export type CheckAvailabilityArgs = {
  treatment_name: string;
  preferred_date: string; // ISO date "YYYY-MM-DD"
  calendar_id?: string;
};

export type BookAppointmentArgs = {
  contact_id?: string; // si no se pasa, lo resolvemos por phone
  phone?: string;
  calendar_id?: string; // opcional, auto-resuelve por treatment_name
  start_time: string; // ISO datetime
  treatment_name: string;
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

// ─── GHL response shapes (mínimos) ───────────────────────────────────────────

type GhlSlot = { startTime: string; endTime: string };
type GhlSlotsResponse = { slots?: GhlSlot[] };
type GhlContact = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
};
type GhlSearchDuplicateResponse = { contact: GhlContact | null };
type GhlContactCreateResponse = { contact: GhlContact };
type GhlAppointment = { id: string };

// Heurística: GHL contact IDs son alfanuméricos de 20 chars sin espacios
// (ej. W5CUSlYRHfeubqP8j29P). Si el agente nos pasa basura ("Gabriel/+542..."),
// la rechazamos y caemos al lookup por teléfono.
function looksLikeGhlId(s: string | undefined | null): boolean {
  if (!s) return false;
  return /^[A-Za-z0-9]{15,30}$/.test(s);
}

async function lookupContactByPhone(
  tenantId: string,
  phone: string,
): Promise<GhlContact | null> {
  // GHL: /contacts/search/duplicate?locationId=...&number=... → { contact: {} | null }
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return null;
  try {
    const data = await ghlFetch<GhlSearchDuplicateResponse>({
      tenantId,
      path: '/contacts/search/duplicate',
      query: { locationId: integration.locationId, number: phone },
    });
    return data.contact ?? null;
  } catch (err) {
    console.error('[lookupContactByPhone]', err);
    return null;
  }
}

async function createContact(
  tenantId: string,
  args: { firstName: string; lastName?: string; phone: string; email?: string },
): Promise<GhlContact | null> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return null;
  try {
    const data = await ghlFetch<GhlContactCreateResponse>({
      tenantId,
      path: '/contacts/',
      method: 'POST',
      body: {
        locationId: integration.locationId,
        firstName: args.firstName,
        lastName: args.lastName ?? '',
        phone: args.phone,
        ...(args.email ? { email: args.email } : {}),
      },
    });
    return data.contact;
  } catch (err) {
    console.error('[createContact]', err);
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ghlNotConnected(): ToolResult {
  return { result: 'El CRM no está conectado aún. Tomá nota del nombre y teléfono del paciente para que recepción lo contacte.' };
}

function formatSlots(slots: GhlSlot[]): string {
  if (slots.length === 0) return 'No hay disponibilidad en esa fecha. Proponé al paciente otra fecha.';
  const formatted = slots
    .slice(0, 4)
    .map((s) =>
      new Date(s.startTime).toLocaleString('es-ES', {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Madrid',
      }),
    )
    .join(', ');
  return `Horarios disponibles: ${formatted}.`;
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

export async function checkAvailability(
  tenantId: string,
  args: CheckAvailabilityArgs,
): Promise<ToolResult> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return ghlNotConnected();

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
      console.warn('[check_availability] preferred_date inválido, asumo mañana:', args.preferred_date);
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
      console.warn('[check_availability] fecha en el pasado:', args.preferred_date, '(hoy es', todayStr, ')');
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
  ctx: { retellCallId?: string } = {},
): Promise<ToolResult> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return ghlNotConnected();

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
    let contactId: string | null = looksLikeGhlId(args.contact_id) ? args.contact_id! : null;
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
      result: `Cita agendada correctamente. El paciente va a recibir confirmación.`,
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

export async function registerPatient(
  tenantId: string,
  args: RegisterPatientArgs,
  ctx: { retellCallId?: string } = {},
): Promise<ToolResult> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return ghlNotConnected();

  if (!args.first_name || !args.phone) {
    return { result: 'Para registrar necesito al menos first_name y phone.' };
  }

  // Si ya existe, devolver el contact_id existente
  const existing = await lookupContactByPhone(tenantId, args.phone);
  if (existing) {
    const name = [existing.firstName, existing.lastName].filter(Boolean).join(' ');
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
    phone: args.phone,
    email: args.email,
  });
  if (!created) {
    return {
      result: 'No pude crear al paciente en el sistema. Tomá nombre y teléfono — recepción confirma manualmente.',
    };
  }

  // Enriquecer la fila de la llamada
  if (ctx.retellCallId) {
    const fullName = [args.first_name, args.last_name].filter(Boolean).join(' ');
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
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return ghlNotConnected();

  try {
    await ghlFetch({
      tenantId,
      path: `/calendars/events/appointments/${args.appointment_id}`,
      method: 'DELETE',
    });

    return { result: 'La cita fue cancelada correctamente.' };
  } catch (err) {
    if (err instanceof GhlApiError && err.status === 404) {
      return { result: 'No encontré esa cita. Puede que ya haya sido cancelada o el ID sea incorrecto.' };
    }
    if (err instanceof GhlApiError) {
      return { result: 'No pude cancelar la cita en este momento. Por favor comunícate con la clínica.' };
    }
    throw err;
  }
}

export async function getPatientInfo(
  tenantId: string,
  args: GetPatientInfoArgs,
  ctx: { retellCallId?: string } = {},
): Promise<ToolResult> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return ghlNotConnected();

  try {
    const contact = await lookupContactByPhone(tenantId, args.phone);
    if (!contact) {
      return {
        result:
          'No encontré al paciente en el sistema. Es un paciente nuevo: pediles nombre y apellido y luego usá register_patient para crearlo antes de agendar.',
      };
    }
    const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Sin nombre';

    // Enriquecer la fila de la llamada con info del contacto encontrado
    if (ctx.retellCallId) {
      await setCallGhlContact(ctx.retellCallId, contact.id, name).catch((e) =>
        console.error('[get_patient_info] enrich call failed:', e),
      );
    }

    return {
      result: `Paciente encontrado: ${name}. contact_id=${contact.id}. Usá ese contact_id para agendar la cita.`,
    };
  } catch (err) {
    console.error('[get_patient_info]', err);
    if (err instanceof GhlApiError) {
      return { result: 'No pude buscar al paciente en este momento.' };
    }
    throw err;
  }
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export type KnownToolName =
  | 'check_availability'
  | 'book_appointment'
  | 'cancel_appointment'
  | 'get_patient_info'
  | 'register_patient';

export type ToolContext = {
  retellCallId?: string;
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
    default:
      return { result: `Tool desconocida: ${toolName}` };
  }
}
