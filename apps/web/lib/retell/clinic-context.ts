import 'server-only';
import { describeAgendaForPrompt } from '@/lib/agenda/agent';
import { closedDaysLabel, closedWeekdays, isoWeekdayOfKey } from '@/lib/agenda/clinic-hours';
import { buildCareProtocolSection } from '@/lib/care-profile/policy';
import { getCareProfile } from '@/lib/care-profile/queries';
import { getClinicSettings, getTenant } from '@/lib/data/clinic';
import { getLeadMemory } from '@/lib/memory/lead-memory';
import { speakWorkingHoursRange } from '@/lib/retell/time-speech';

type DayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

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

/** "lunes 15:00-20:30; martes 15:00-20:30": para el prompt escrito. */
function formatWorkingHoursPlain(
  wh: Record<string, { open: string; close: string } | null> | null | undefined,
): string {
  if (!wh) return 'horarios no configurados';
  const parts: string[] = [];
  for (const day of Object.keys(DAY_LABEL) as DayKey[]) {
    const slot = wh[day];
    if (slot?.open && slot?.close) parts.push(`${DAY_LABEL[day]} ${slot.open}-${slot.close}`);
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
  opts?: { leadPhoneE164?: string | null },
): Promise<Record<string, string>> {
  // Si hay teléfono del lead, cargamos su memoria cross-canal en paralelo
  // (best-effort: si falla, va vacío). Se inyecta como {{lead_memory}} para
  // que el agente de voz "recuerde" lo hablado por WhatsApp o llamadas previas.
  const [clinic, tenant, leadMem, professionals, careProfile] = await Promise.all([
    getClinicSettings(tenantId),
    getTenant(tenantId),
    opts?.leadPhoneE164
      ? getLeadMemory(tenantId, opts.leadPhoneE164).catch(() => null)
      : Promise.resolve(null),
    // Profesionales con agenda en la plataforma. Vacío si la clínica no la usa
    // —y entonces el agente no debe nombrar a nadie—; un fallo aquí no puede
    // tumbar la llamada, por eso va con catch.
    describeAgendaForPrompt(tenantId).catch(() => ''),
    // Perfil de atención (pediatría). Casi siempre null; nunca tumba la llamada.
    getCareProfile(tenantId).catch(() => null),
  ]);
  const phones = (clinic?.phones ?? []).filter(Boolean);
  // Días con horario especial (una mañana suelta): van detrás del horario
  // semanal, en los dos formatos. Vacío si no hay ninguno.
  const { specialDaysPromptText } = await import('@/lib/agenda/special-days-db');
  const special = await specialDaysPromptText(tenantId, clinic?.timezone ?? 'Europe/Madrid');
  const withSpecial = (base: string) => (special.text ? `${base}\n${special.text}` : base);
  const closedLabel = closedDaysLabel(clinic?.workingHours);
  const closedHasSpecial =
    closedLabel !== '' &&
    special.days.some((d) =>
      closedWeekdays(clinic?.workingHours).includes(isoWeekdayOfKey(d) ?? 0),
    );
  return {
    clinic_name: normalizeTenantName(tenant?.name),
    clinic_address: clinic?.address?.trim() || 'no especificada',
    clinic_phones: phones.length ? phones.join(', ') : 'no especificados',
    working_hours_text: withSpecial(formatWorkingHours(clinic?.workingHours)),
    working_hours_plain: withSpecial(formatWorkingHoursPlain(clinic?.workingHours)),
    // "sábado y domingo": los días que el asistente no puede ofrecer ni mirar
    // (salvo que uno de ellos tenga horario especial).
    closed_days_text: closedHasSpecial
      ? `${closedLabel} (salvo los días con horario especial indicados en el horario)`
      : closedLabel,
    clinic_timezone: clinic?.timezone ?? 'America/Mexico_City',
    after_hours_message: clinic?.afterHoursMessage?.trim() || '',
    recording_consent: clinic?.recordingConsentText?.trim() || '',
    clinic_transfer_number: clinic?.transferNumber?.trim() || '',
    // Vacío si no hay memoria. El prompt del agente Retell debe referenciar
    // {{lead_memory}} para usarlo (config en el dashboard de Retell).
    lead_memory: leadMem?.profileSummary?.trim() || '',
    // Referenciable como {{professionals}} en el prompt del agente de Retell.
    // Los huecos concretos siguen saliendo de check_availability.
    professionals: professionals.trim(),
    // Referenciable como {{care_protocol}}: cómo atiende la clínica cuando
    // tiene perfil (quién es el paciente, protocolo de primera visita, tools
    // con patient_id). Vacío para el resto.
    care_protocol: careProfile ? buildCareProtocolSection(careProfile) : '',
  };
}
