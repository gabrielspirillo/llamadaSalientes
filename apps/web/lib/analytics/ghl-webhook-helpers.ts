// Helpers puros para el webhook GHL appointment. Aislados aquí para
// poder unit-testearlos sin levantar el handler completo.
//
// GHL envía dos formatos distintos según el camino:
//
// 1. API/integraciones de tipo webhook nativo (lo que documenta el portal):
//      { type, locationId, appointment: { id, status, startTime, ... } }
//
// 2. Workflow Builder → acción "Webhook" (lo que pasa cuando configurás
//    el evento desde Automatización → Flujos de trabajo): el payload viene
//    plano con la cita anidada dentro de `calendar` (sí, GHL lo llama así
//    aunque sea la cita), el id está en `calendar.appointmentId`, el estado
//    en `calendar.appoinmentStatus` (typo de GHL conservado), y `type` no
//    se envía: hay que sacarlo de `customData.type` que la persona que
//    configura el workflow define como literal.
//
// `normalizeAppointment` lee cualquiera de los dos shapes y devuelve la
// forma canónica que usa el resto del código.

export type GhlAppointmentCore = {
  id?: string;
  calendarId?: string;
  contactId?: string;
  startTime?: string;
  endTime?: string;
  status?: string;
  treatmentId?: string;
  dateAdded?: string;
};

export type GhlAppointmentPayload = {
  type?: string;
  locationId?: string;
  appointment?: GhlAppointmentCore;
  // Workflow Builder shape:
  calendar?: {
    id?: string;
    appointmentId?: string;
    appoinmentStatus?: string; // [sic] typo de GHL
    appointmentStatus?: string;
    status?: string;
    startTime?: string;
    endTime?: string;
    date_created?: string;
  };
  location?: { id?: string };
  contact_id?: string;
  customData?: { type?: string } & Record<string, unknown>;
};

export function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function normalizeAppointment(payload: GhlAppointmentPayload): {
  appointment: GhlAppointmentCore;
  locationId: string | undefined;
  type: string | undefined;
} {
  const apt = payload.appointment ?? {};
  const cal = payload.calendar ?? {};

  return {
    appointment: {
      id: apt.id ?? cal.appointmentId,
      calendarId: apt.calendarId ?? cal.id,
      contactId: apt.contactId ?? payload.contact_id,
      startTime: apt.startTime ?? cal.startTime,
      endTime: apt.endTime ?? cal.endTime,
      status:
        apt.status ??
        cal.appoinmentStatus ??
        cal.appointmentStatus ??
        cal.status,
      treatmentId: apt.treatmentId,
      dateAdded: apt.dateAdded ?? cal.date_created,
    },
    locationId: payload.locationId ?? payload.location?.id,
    type: payload.type ?? payload.customData?.type,
  };
}

export function classifyEvent(
  payload: GhlAppointmentPayload,
): 'create' | 'cancel' | null {
  const { appointment, type: rawType } = normalizeAppointment(payload);
  const type = (rawType ?? '').toLowerCase();
  const status = (appointment.status ?? '').toLowerCase();

  if (/appointment\.?delete/.test(type)) return 'cancel';
  if (status === 'cancelled' || status === 'canceled' || status === 'no_show') return 'cancel';
  if (/appointment\.?create/.test(type)) return 'create';
  // Workflow Builder no manda `type` por defecto: cuando no hay `type` y el
  // status indica reserva activa (confirmed/scheduled/booked), tratamos como
  // create. El filtro del propio workflow garantiza que solo dispare en el
  // momento de la reserva, no en updates posteriores. Si `type` viene
  // explícito (caso nativo) no aplicamos esta heurística para evitar
  // confundir AppointmentUpdate con AppointmentCreate.
  if (!type && (status === 'confirmed' || status === 'scheduled' || status === 'booked'))
    return 'create';
  return null;
}
