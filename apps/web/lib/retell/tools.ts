import 'server-only';
import { GhlApiError, ghlFetch } from '@/lib/ghl/client';
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
  return { result: 'El CRM no está conectado aún. Por favor dile al paciente que un agente humano le contactará para confirmar.' };
}

function formatSlots(slots: GhlSlot[]): string {
  if (slots.length === 0) return 'No hay disponibilidad en esa fecha. Intenta con otra fecha.';
  const formatted = slots
    .slice(0, 5)
    .map((s) => new Date(s.startTime).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }))
    .join(', ');
  return `Horarios disponibles: ${formatted}`;
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

export async function checkAvailability(
  tenantId: string,
  args: CheckAvailabilityArgs,
): Promise<ToolResult> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return ghlNotConnected();

  try {
    const startTime = new Date(args.preferred_date).toISOString();
    const endTime = new Date(
      new Date(args.preferred_date).setDate(new Date(args.preferred_date).getDate() + 1),
    ).toISOString();

    const data = await ghlFetch<GhlSlotsResponse>({
      tenantId,
      path: '/calendars/free-slots',
      query: {
        calendarId: args.calendar_id ?? integration.locationId,
        startDate: startTime,
        endDate: endTime,
      },
    });

    return { result: formatSlots(data.slots ?? []) };
  } catch (err) {
    if (err instanceof GhlApiError) {
      return { result: 'No pude consultar el calendario en este momento. El agente humano te contactará para confirmar.' };
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
    const appointment = await ghlFetch<GhlAppointment>({
      tenantId,
      path: '/calendars/events/appointments',
      method: 'POST',
      body: {
        calendarId: args.calendar_id,
        locationId: integration.locationId,
        contactId: args.contact_id,
        startTime: args.start_time,
        title: args.treatment_name,
      },
    });

    return { result: `Cita agendada correctamente. ID: ${appointment.id}. El paciente recibirá una confirmación.` };
  } catch (err) {
    if (err instanceof GhlApiError) {
      return { result: 'No pude agendar la cita en este momento. Por favor comunícate con la clínica directamente.' };
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
