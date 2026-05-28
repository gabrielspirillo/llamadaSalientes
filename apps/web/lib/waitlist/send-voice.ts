import 'server-only';
import { triggerCallback } from '@/lib/calls/trigger-callback';
import type { WaitlistVars } from '@/lib/waitlist/types';

// Llama al paciente con use_case='waitlist_offer'. El LLM outbound de Retell
// (DentalVoice — Outbound) tiene un branch específico para este use_case que
// usa las dynamic vars de la oferta. Si extraPromptInstructions tiene valor,
// se inyecta como guidance adicional ({{waitlist_extra_instructions}}).
//
// Nombres de dynamic vars alineados con los que ya consume el prompt:
//   patient_name, clinic_name, clinic_phones, clinic_timezone, current_date
//     (los pone triggerCallback / buildClinicContextVars).
//   offer_id, old_appointment_{date,time,datetime},
//   new_slot_{date,time,datetime,duration_minutes}, treatment_name,
//   waitlist_extra_instructions.

export async function sendWaitlistVoice(args: {
  tenantId: string;
  offerId: string;
  toPhoneE164: string;
  vars: WaitlistVars;
  contactDisplayName: string | null;
  ghlContactId: string | null;
  /** Texto adicional del operador (voice_prompt_override) que se pasa al
   * agente como `waitlist_extra_instructions`. Opcional. */
  extraPromptInstructions?: string | null;
}): Promise<{ ok: true; callId: string } | { ok: false; reason: string }> {
  const {
    tenantId,
    offerId,
    toPhoneE164,
    vars,
    contactDisplayName,
    ghlContactId,
    extraPromptInstructions,
  } = args;

  const result = await triggerCallback({
    tenantId,
    toNumber: toPhoneE164,
    patientName: contactDisplayName,
    ghlContactId,
    source: 'waitlist',
    useCase: 'waitlist_offer',
    createContactIfMissing: false,
    dynamicVars: {
      offer_id: offerId,
      old_appointment_date: vars.oldAppointment.date,
      old_appointment_time: vars.oldAppointment.time,
      old_appointment_datetime: vars.oldAppointment.dateTime,
      new_slot_date: vars.newSlot.date,
      new_slot_time: vars.newSlot.time,
      new_slot_datetime: vars.newSlot.dateTime,
      new_slot_duration_minutes: vars.newSlot.durationMinutes,
      treatment_name: vars.treatment,
      waitlist_extra_instructions: (extraPromptInstructions ?? '').trim(),
    },
  });

  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, callId: result.callId };
}
