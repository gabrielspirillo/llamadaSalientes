import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from '@/lib/env';

/**
 * Override scoped por request para credenciales GHL. Cuando está activo,
 * `getGhlIntegration`, `getValidAccessToken` y `resolveCalendarId` lo
 * consultan ANTES de tocar la DB del tenant.
 *
 * Casos de uso: la landing demo agenda en un location/calendar dedicado
 * de FUTURA, distinto del GHL configurado para el tenant (que se usa
 * para inbound u otros flows del mismo tenant).
 *
 * Se setea en los entry points (/api/public/demo-call y /api/retell/tools
 * cuando metadata.source==='landing_demo') y se propaga via AsyncLocalStorage
 * a todas las funciones aguas abajo sin tocar sus firmas.
 */
export type GhlOverride = {
  pit: string;
  locationId: string;
  defaultCalendarId: string;
};

const storage = new AsyncLocalStorage<GhlOverride>();

export function getGhlOverride(): GhlOverride | undefined {
  return storage.getStore();
}

export function withGhlOverride<T>(override: GhlOverride, fn: () => Promise<T>): Promise<T> {
  return storage.run(override, fn);
}

/**
 * Construye el override desde env vars si las 3 están seteadas. Devuelve
 * null si falta alguna — la idea es que en ausencia de config explícita
 * el flow demo cae al GHL del tenant (comportamiento previo).
 */
export function buildDemoOverrideFromEnv(): GhlOverride | null {
  const pit = env.FUTURA_DEMO_GHL_PIT;
  const locationId = env.FUTURA_DEMO_GHL_LOCATION_ID;
  const defaultCalendarId = env.FUTURA_DEMO_GHL_CALENDAR_ID;
  if (!pit || !locationId || !defaultCalendarId) return null;
  return { pit, locationId, defaultCalendarId };
}
