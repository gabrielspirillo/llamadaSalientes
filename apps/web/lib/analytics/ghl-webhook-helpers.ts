// Helpers puros para el webhook GHL appointment. Aislados aquí para
// poder unit-testearlos sin levantar el handler completo.

export type GhlAppointmentPayload = {
  type?: string;
  locationId?: string;
  appointment?: {
    id?: string;
    calendarId?: string;
    contactId?: string;
    startTime?: string;
    endTime?: string;
    status?: string;
    treatmentId?: string;
    dateAdded?: string;
  };
};

export function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function classifyEvent(payload: GhlAppointmentPayload): 'create' | 'cancel' | null {
  const type = (payload.type ?? '').toLowerCase();
  const status = (payload.appointment?.status ?? '').toLowerCase();

  if (/appointment\.?delete/.test(type)) return 'cancel';
  if (status === 'cancelled' || status === 'canceled' || status === 'no_show') return 'cancel';
  if (/appointment\.?create/.test(type)) return 'create';
  return null;
}
