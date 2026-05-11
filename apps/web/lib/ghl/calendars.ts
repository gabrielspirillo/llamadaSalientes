import 'server-only';
import { ghlFetch } from '@/lib/ghl/client';
import { getGhlIntegration } from '@/lib/data/ghl-integration';

export type GhlCalendar = {
  id: string;
  name?: string;
  isActive?: boolean;
  calendarType?: string;
};

export type GhlSlot = { startTime: string; endTime: string };

type ListResponse = { calendars?: GhlCalendar[] };

export type DayKey = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

const DAY_TO_NUMBER: Record<DayKey, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 0,
};

/**
 * Lista calendarios de la sub-account de GHL.
 * Endpoint: GET /calendars/?locationId={id}
 */
export async function listCalendars(tenantId: string): Promise<GhlCalendar[]> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return [];

  const data = await ghlFetch<ListResponse>({
    tenantId,
    path: '/calendars/',
    query: { locationId: integration.locationId },
  });
  return data.calendars ?? [];
}

/**
 * Resuelve el calendario a usar para una llamada:
 *   1. Si se pasa explícito, lo usa.
 *   2. Match fuzzy del treatmentName contra treatments del tenant
 *      (cualquier palabra significativa del input matcheada por ILIKE).
 *   3. Fallback: primer calendario activo de la location.
 *   4. Sino, retorna null (caller maneja error friendly).
 */
export async function resolveCalendarId(
  tenantId: string,
  options: { explicitCalendarId?: string | null; treatmentName?: string | null } = {},
): Promise<{ calendarId: string | null; reason: string }> {
  if (options.explicitCalendarId) {
    return { calendarId: options.explicitCalendarId, reason: 'explicit' };
  }

  if (options.treatmentName) {
    const { db } = await import('@/lib/db/client');
    const { treatments } = await import('@/lib/db/schema');
    const { and, eq, ilike, or } = await import('drizzle-orm');

    // Tokenizar input del agente y buscar cada palabra ≥ 4 chars contra treatment.name.
    // Esto resuelve "blanqueamiento dental" matcheando "Blanqueamiento", o "limpieza profunda"
    // matcheando "Limpieza dental", etc. Acumulamos OR de ILIKE %word%.
    const words = options.treatmentName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // quitar acentos
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !['para', 'cita', 'dental', 'consulta'].includes(w));

    if (words.length > 0) {
      const ilikes = words.map((w) => ilike(treatments.name, `%${w}%`));
      const search = ilikes.length === 1 ? ilikes[0]! : or(...ilikes);

      const rows = await db
        .select({ ghlCalendarId: treatments.ghlCalendarId, name: treatments.name })
        .from(treatments)
        .where(and(eq(treatments.tenantId, tenantId), search!))
        .limit(1);

      const id = rows[0]?.ghlCalendarId;
      if (id) return { calendarId: id, reason: `treatment-match:${rows[0]?.name}` };
    }
  }

  // Fallback: primer calendario activo
  const cals = await listCalendars(tenantId);
  const active = cals.find((c) => c.isActive !== false);
  if (active) return { calendarId: active.id, reason: 'first-active' };

  return { calendarId: null, reason: 'no-calendars' };
}

/**
 * Obtiene los slots libres para un calendario en un rango.
 * Endpoint: GET /calendars/{calendarId}/free-slots
 * Fechas como **ms epoch**, no ISO.
 *
 * GHL devuelve uno de dos shapes:
 *   1. { slots: [{startTime, endTime}, ...] }
 *   2. { 'YYYY-MM-DD': { slots: ['ISO', ...] }, traceId: '...' }
 */
export async function getFreeSlots(
  tenantId: string,
  calendarId: string,
  range: { startDateMs: number; endDateMs: number; timezone?: string },
): Promise<GhlSlot[]> {
  const data = await ghlFetch<Record<string, unknown>>({
    tenantId,
    path: `/calendars/${calendarId}/free-slots`,
    query: {
      startDate: range.startDateMs,
      endDate: range.endDateMs,
      timezone: range.timezone ?? 'Europe/Madrid',
    },
  });

  // Shape 1: slots[] directo (legacy)
  if (Array.isArray((data as { slots?: GhlSlot[] }).slots)) {
    return ((data as { slots: GhlSlot[] }).slots) ?? [];
  }

  // Shape 2: keys son fechas YYYY-MM-DD; cada una tiene { slots: ['ISO', ...] }
  const dateKeyRegex = /^\d{4}-\d{2}-\d{2}$/;
  const allSlots: GhlSlot[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!dateKeyRegex.test(key)) continue; // skip traceId, etc
    const day = value as { slots?: string[] };
    if (!day?.slots) continue;
    for (const startIso of day.slots) {
      const start = new Date(startIso);
      const end = new Date(start.getTime() + 30 * 60_000); // estimación 30 min
      allSlots.push({ startTime: start.toISOString(), endTime: end.toISOString() });
    }
  }
  return allSlots;
}

/**
 * Crea un calendario en GHL para un tratamiento específico.
 * Devuelve el calendarId creado.
 */
export async function createCalendarForTreatment(
  tenantId: string,
  args: {
    name: string;
    durationMinutes: number;
    days: DayKey[];
    startTime: string; // "09:00"
    endTime: string; // "18:00"
  },
): Promise<string | null> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return null;

  // GHL espera openHours como array por día numérico (Sun=0 .. Sat=6)
  const openHours = args.days.map((d) => ({
    daysOfTheWeek: [DAY_TO_NUMBER[d]],
    hours: [{ openHour: parseHour(args.startTime), openMinute: parseMinute(args.startTime), closeHour: parseHour(args.endTime), closeMinute: parseMinute(args.endTime) }],
  }));

  const body = {
    locationId: integration.locationId,
    name: args.name,
    description: '',
    calendarType: 'event',
    eventType: 'RoundRobin_OptimizeForAvailability',
    slotDuration: args.durationMinutes,
    slotDurationUnit: 'mins',
    slotInterval: args.durationMinutes,
    slotIntervalUnit: 'mins',
    slotBuffer: 0,
    slotBufferUnit: 'mins',
    preBufferUnit: 'mins',
    appoinmentPerSlot: 1,
    appoinmentPerDay: 0,
    allowBookingAfter: 0,
    allowBookingAfterUnit: 'hours',
    allowBookingFor: 30,
    allowBookingForUnit: 'days',
    openHours,
    enableRecurring: false,
    autoConfirm: true,
    googleInvitationEmails: false,
    allowReschedule: true,
    allowCancellation: true,
    isActive: true,
    formSubmitType: 'ThankYouMessage',
    formSubmitRedirectURL: '',
    formSubmitThanksMessage: 'Gracias, recibimos tu reserva.',
  };

  const data = await ghlFetch<{ id?: string; calendar?: { id?: string } }>({
    tenantId,
    path: '/calendars/',
    method: 'POST',
    body,
  });
  return data.id ?? data.calendar?.id ?? null;
}

export async function deleteCalendar(tenantId: string, calendarId: string): Promise<void> {
  await ghlFetch({
    tenantId,
    path: `/calendars/${calendarId}`,
    method: 'DELETE',
  });
}

function parseHour(t: string): number {
  return Number(t.split(':')[0] ?? 0);
}
function parseMinute(t: string): number {
  return Number(t.split(':')[1] ?? 0);
}

/**
 * Próximas citas del location en los próximos N días.
 * Itera los calendarios y consolida appointments.
 */
export type UpcomingAppointment = {
  id: string;
  calendarId: string;
  calendarName: string | null;
  contactId: string | null;
  contactName: string | null;
  startTime: string;
  endTime: string | null;
  status: string | null;
  title: string | null;
};

export async function listUpcomingAppointments(
  tenantId: string,
  daysAhead = 14,
): Promise<UpcomingAppointment[]> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return [];

  const cals = await listCalendars(tenantId);
  if (cals.length === 0) return [];

  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + daysAhead);

  type RawAppt = {
    id: string;
    calendarId?: string;
    contactId?: string;
    contact?: { id?: string; firstName?: string; lastName?: string };
    startTime?: string;
    endTime?: string;
    appointmentStatus?: string;
    status?: string;
    title?: string;
  };

  const results: UpcomingAppointment[] = [];
  for (const cal of cals) {
    try {
      const data = await ghlFetch<{ events?: RawAppt[]; appointments?: RawAppt[] }>({
        tenantId,
        path: '/calendars/events',
        query: {
          locationId: integration.locationId,
          calendarId: cal.id,
          startTime: now.getTime(),
          endTime: end.getTime(),
        },
      });
      const items = data.events ?? data.appointments ?? [];
      for (const a of items) {
        if (!a.startTime) continue;
        const cname = a.contact
          ? [a.contact.firstName, a.contact.lastName].filter(Boolean).join(' ')
          : null;
        results.push({
          id: a.id,
          calendarId: cal.id,
          calendarName: cal.name ?? null,
          contactId: a.contactId ?? a.contact?.id ?? null,
          contactName: cname || null,
          startTime: a.startTime,
          endTime: a.endTime ?? null,
          status: a.appointmentStatus ?? a.status ?? null,
          title: a.title ?? null,
        });
      }
    } catch (err) {
      console.error('[listUpcomingAppointments] cal', cal.id, err);
    }
  }

  // Ordenar por startTime ascendente
  results.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  return results;
}
