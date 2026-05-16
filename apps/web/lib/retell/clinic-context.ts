import 'server-only';
import { getClinicSettings, getTenant } from '@/lib/data/clinic';
import { speakWorkingHoursRange } from '@/lib/retell/time-speech';

type DayKey =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

const DAY_LABEL: Record<DayKey, string> = {
  monday: 'lunes',
  tuesday: 'martes',
  wednesday: 'miércoles',
  thursday: 'jueves',
  friday: 'viernes',
  saturday: 'sábado',
  sunday: 'domingo',
};

function formatWorkingHours(
  wh: Record<string, { open: string; close: string } | null> | null | undefined,
): string {
  if (!wh) return 'horarios no configurados';
  const parts: string[] = [];
  for (const day of Object.keys(DAY_LABEL) as DayKey[]) {
    const slot = wh[day];
    if (slot?.open && slot?.close) {
      parts.push(`${DAY_LABEL[day]} ${speakWorkingHoursRange(slot.open, slot.close)}`);
    }
  }
  return parts.length ? parts.join('; ') : 'sin horarios cargados';
}

function normalizeTenantName(name: string | undefined | null): string {
  if (!name) return 'la clínica';
  if (/['']s organization|^test|^demo/i.test(name)) return 'Futura Solutions';
  return name;
}

/**
 * Devuelve el set de dynamic variables con la info de la clínica que se inyecta
 * en cada llamada de Retell. Mantener los valores cortos: solo lo que el agente
 * necesita SIEMPRE al alcance. Lo grande (catálogo de tratamientos, FAQs) se
 * resuelve vía tools.
 */
export async function buildClinicContextVars(
  tenantId: string,
): Promise<Record<string, string>> {
  const [clinic, tenant] = await Promise.all([
    getClinicSettings(tenantId),
    getTenant(tenantId),
  ]);
  const phones = (clinic?.phones ?? []).filter(Boolean);
  return {
    clinic_name: normalizeTenantName(tenant?.name),
    clinic_address: clinic?.address?.trim() || 'no especificada',
    clinic_phones: phones.length ? phones.join(', ') : 'no especificados',
    working_hours_text: formatWorkingHours(clinic?.workingHours),
    clinic_timezone: clinic?.timezone ?? 'America/Mexico_City',
    after_hours_message: clinic?.afterHoursMessage?.trim() || '',
    recording_consent: clinic?.recordingConsentText?.trim() || '',
    clinic_transfer_number: clinic?.transferNumber?.trim() || '',
  };
}
