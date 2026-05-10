import 'server-only';
import { GhlApiError, ghlFetch } from '@/lib/ghl/client';
import { getFreeSlots, resolveCalendarId } from '@/lib/ghl/calendars';
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
  contact_id: string;
  calendar_id: string;
  start_time: string; // ISO datetime
  treatment_name: string;
};

export type CancelAppointmentArgs = {
  appointment_id: string;
};

export type GetPatientInfoArgs = {
  phone: string;
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
type GhlContactsResponse = { contacts?: GhlContact[] };
type GhlAppointment = { id: string };

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
): Promise<ToolResult> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return ghlNotConnected();

  try {
    // Resolver calendarId si el agente no lo conoce
    const resolved = await resolveCalendarId(tenantId, {
      explicitCalendarId: args.calendar_id ?? null,
      treatmentName: args.treatment_name,
    });

    if (!resolved.calendarId) {
      return {
        result:
          'No puedo agendar porque la clínica no tiene calendarios configurados. Tomá nombre y teléfono — recepción confirma manualmente.',
      };
    }

    const appointment = await ghlFetch<GhlAppointment>({
      tenantId,
      path: '/calendars/events/appointments',
      method: 'POST',
      body: {
        calendarId: resolved.calendarId,
        locationId: integration.locationId,
        contactId: args.contact_id,
        startTime: args.start_time,
        title: args.treatment_name,
      },
    });

    return {
      result: `Cita agendada correctamente. ID ${appointment.id}. El paciente va a recibir confirmación.`,
    };
  } catch (err) {
    if (err instanceof GhlApiError) {
      return {
        result: `No pude agendar (error ${err.status}). Tomá nombre y teléfono y avisá que recepción confirma a la brevedad.`,
      };
    }
    throw err;
  }
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
): Promise<ToolResult> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return ghlNotConnected();

  try {
    const data = await ghlFetch<GhlContactsResponse>({
      tenantId,
      path: '/contacts/search',
      query: { locationId: integration.locationId, phone: args.phone },
    });

    const contact = data.contacts?.[0];
    if (!contact) {
      return { result: 'No encontré al paciente en el sistema. Es un paciente nuevo.' };
    }

    const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Sin nombre';
    return { result: `Paciente encontrado: ${name}. ID: ${contact.id}. Email: ${contact.email ?? 'no registrado'}.` };
  } catch (err) {
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
  | 'get_patient_info';

export async function dispatchTool(
  tenantId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  switch (toolName as KnownToolName) {
    case 'check_availability':
      return checkAvailability(tenantId, args as CheckAvailabilityArgs);
    case 'book_appointment':
      return bookAppointment(tenantId, args as BookAppointmentArgs);
    case 'cancel_appointment':
      return cancelAppointment(tenantId, args as CancelAppointmentArgs);
    case 'get_patient_info':
      return getPatientInfo(tenantId, args as GetPatientInfoArgs);
    default:
      return { result: `Tool desconocida: ${toolName}` };
  }
}
