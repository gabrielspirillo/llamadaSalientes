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
 *   2. Si el tratamiento tiene ghlCalendarId, lo usa.
 *   3. Si no, primer calendario activo de la location.
 *   4. Sino, retorna null (caller maneja error friendly).
 */
export async function resolveCalendarId(
  tenantId: string,
  options: { explicitCalendarId?: string | null; treatmentName?: string | null } = {},
): Promise<{ calendarId: string | null; reason: string }> {
  if (options.explicitCalendarId) {
    return { calendarId: options.explicitCalendarId, reason: 'explicit' };
  }

  // Match por nombre de tratamiento en nuestra DB
  if (options.treatmentName) {
    const { db } = await import('@/lib/db/client');
    const { treatments } = await import('@/lib/db/schema');
    const { and, eq, ilike } = await import('drizzle-orm');
    const rows = await db
      .select({ ghlCalendarId: treatments.ghlCalendarId })
      .from(treatments)
      .where(
        and(
          eq(treatments.tenantId, tenantId),
          ilike(treatments.name, `%${options.treatmentName}%`),
        ),
      )
      .limit(1);
    const id = rows[0]?.ghlCalendarId;
    if (id) return { calendarId: id, reason: 'treatment-match' };
  }

  // Fallback: primer calendario activo
  const cals = await listCalendars(tenantId);
  const active = cals.find((c) => c.isActive !== false);
  if (active) return { calendarId: active.id, reason: 'first-active' };

  return { calendarId: null, reason: 'no-calendars' };
}

/**
 * Obtiene los slots libres para un calendario en un rango.
 * Endpoint correcto: GET /calendars/{calendarId}/free-slots
 * Las fechas van como **milisegundos epoch**, no ISO.
 */
export async function getFreeSlots(
  tenantId: string,
  calendarId: string,
  range: { startDateMs: number; endDateMs: number; timezone?: string },
): Promise<GhlSlot[]> {
  const data = await ghlFetch<{ slots?: GhlSlot[]; _dates_?: Record<string, { slots?: string[] }> }>({
    tenantId,
    path: `/calendars/${calendarId}/free-slots`,
    query: {
      startDate: range.startDateMs,
      endDate: range.endDateMs,
      timezone: range.timezone ?? 'Europe/Madrid',
    },
  });

  // GHL puede devolver slots[] directo, o { _dates_: { 'YYYY-MM-DD': { slots: ['ISO', ...] } } }
  if (data.slots && data.slots.length > 0) return data.slots;

  if (data._dates_) {
    const allSlots: GhlSlot[] = [];
    for (const day of Object.values(data._dates_)) {
      if (!day.slots) continue;
      for (const startIso of day.slots) {
        // GHL devuelve sólo startTime; estimamos endTime sumando 30 min
        const start = new Date(startIso);
        const end = new Date(start.getTime() + 30 * 60_000);
        allSlots.push({ startTime: start.toISOString(), endTime: end.toISOString() });
      }
    }
    return allSlots;
  }

  return [];
}
