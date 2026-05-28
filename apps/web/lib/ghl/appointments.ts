import 'server-only';

import { getGhlIntegration } from '@/lib/data/ghl-integration';
import { ghlFetch } from '@/lib/ghl/client';

/**
 * Representación mínima de un appointment de GHL que nos importa.
 * GHL devuelve más campos (assignedUserId, address, notes, etc.) pero
 * nosotros solo cacheamos lo que sale en el sidebar / página de detalle.
 */
export type GhlAppointment = {
  id: string;
  contactId?: string | null;
  locationId?: string | null;
  calendarId?: string | null;
  appointmentStatus?: string | null;
  assignedUserId?: string | null;
  title?: string | null;
  startTime?: string | null;
  endTime?: string | null;
};

type ListResponse = { events?: GhlAppointment[]; appointments?: GhlAppointment[] };

/**
 * Lista appointments de un contacto. Endpoint:
 *   GET /contacts/{contactId}/appointments
 *
 * Devuelve [] si:
 *   - El tenant no tiene GHL conectado.
 *   - El contacto no existe en GHL.
 *   - La API falla (best-effort: no tira).
 */
export async function listAppointmentsForContact(
  tenantId: string,
  contactId: string,
): Promise<GhlAppointment[]> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return [];
  try {
    const data = await ghlFetch<ListResponse>({
      tenantId,
      path: `/contacts/${contactId}/appointments`,
    });
    // GHL alterna nombres: a veces `events`, a veces `appointments`.
    return data.events ?? data.appointments ?? [];
  } catch (err) {
    console.warn('[listAppointmentsForContact]', { contactId, err: (err as Error).message });
    return [];
  }
}

/**
 * Trae UN appointment por id. Útil para enriquecer una creación o un
 * webhook que solo trae el appointmentId.
 *   GET /calendars/events/appointments/{id}
 */
export async function getAppointment(
  tenantId: string,
  appointmentId: string,
): Promise<GhlAppointment | null> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return null;
  try {
    const data = await ghlFetch<{ event?: GhlAppointment; appointment?: GhlAppointment }>({
      tenantId,
      path: `/calendars/events/appointments/${appointmentId}`,
    });
    return data.event ?? data.appointment ?? null;
  } catch (err) {
    console.warn('[getAppointment]', { appointmentId, err: (err as Error).message });
    return null;
  }
}

/**
 * Lista appointments del calendar dentro de un rango temporal.
 *   GET /calendars/events?locationId&calendarId&startTime&endTime
 *
 * startTime/endTime van en milisegundos (timestamp UNIX). Devuelve [] si la
 * API falla o el calendar está vacío. Best-effort: no tira.
 */
export async function listAppointmentsByCalendar(
  tenantId: string,
  calendarId: string,
  startTimeMs: number,
  endTimeMs: number,
): Promise<GhlAppointment[]> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return [];
  try {
    const data = await ghlFetch<{ events?: GhlAppointment[]; appointments?: GhlAppointment[] }>({
      tenantId,
      path: '/calendars/events',
      query: {
        locationId: integration.locationId,
        calendarId,
        startTime: String(startTimeMs),
        endTime: String(endTimeMs),
      },
    });
    return data.events ?? data.appointments ?? [];
  } catch (err) {
    console.warn('[listAppointmentsByCalendar]', {
      calendarId,
      err: (err as Error).message,
    });
    return [];
  }
}

/**
 * Helper agregado: itera todos los calendars del location y trae las citas
 * dentro del rango indicado, deduplicadas por id. Usado por el backfill de
 * recordatorios para procesar citas existentes pre-webhook.
 */
export async function listAppointmentsInRange(
  tenantId: string,
  startTimeMs: number,
  endTimeMs: number,
): Promise<GhlAppointment[]> {
  // Import dinámico para no crear ciclo (calendars.ts también vive aquí).
  const { listCalendars } = await import('@/lib/ghl/calendars');
  const calendars = await listCalendars(tenantId);
  if (calendars.length === 0) return [];

  const all: GhlAppointment[] = [];
  const seen = new Set<string>();
  for (const cal of calendars) {
    if (!cal.id) continue;
    const batch = await listAppointmentsByCalendar(tenantId, cal.id, startTimeMs, endTimeMs);
    for (const appt of batch) {
      if (!appt.id || seen.has(appt.id)) continue;
      seen.add(appt.id);
      all.push(appt);
    }
  }
  return all;
}
