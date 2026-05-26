/**
 * Helpers compartidos por los dos providers de telefonía (Twilio y Zadarma).
 *
 * El tipo TelephonyProvider se usa en:
 *   - tenant_telephony.provider (DB)
 *   - rutas /api/telephony/* (discriminator en body)
 *   - UI de configuración (selector de provider)
 *
 * Mantenemos la enumeración acá (string union, no enum de TS) para
 * cero overhead en el bundle y compatibilidad nativa con zod.
 */

export type TelephonyProvider = 'twilio' | 'zadarma';

export const TELEPHONY_PROVIDERS = ['twilio', 'zadarma'] as const satisfies readonly TelephonyProvider[];

export function isTelephonyProvider(value: unknown): value is TelephonyProvider {
  return value === 'twilio' || value === 'zadarma';
}

export function providerLabel(p: TelephonyProvider): string {
  return p === 'twilio' ? 'Twilio' : 'Zadarma';
}
