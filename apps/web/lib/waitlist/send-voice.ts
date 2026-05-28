import 'server-only';
import { triggerCallback } from '@/lib/calls/trigger-callback';
import type { WaitlistVars } from '@/lib/waitlist/types';

// Llama al paciente con use_case='waitlist_offer'. El LLM outbound de Retell
// (DentalVoice — Outbound) lee las dynamicVars y propone el slot adelantado.
// Cuando el paciente acepta, el agente llama a la tool `accept_waitlist_offer`
// con offerId.

export async function sendWaitlistVoice(args: {
  tenantId: string;
  offerId: string;
  toPhoneE164: string;
  vars: WaitlistVars;
  contactDisplayName: string | null;
  ghlContactId: string | null;
}): Promise<{ ok: true; callId: string } | { ok: false; reason: string }> {
  const { tenantId, offerId, toPhoneE164, vars, contactDisplayName, ghlContactId } = args;

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
      fecha_cita_vieja: vars.oldAppointment.dateTime,
      fecha_cita_nueva: vars.newSlot.dateTime,
      hora_cita_nueva: vars.newSlot.time,
      tratamiento: vars.treatment,
      paciente_nombre: vars.contact.firstName || vars.contact.fullName,
      clinica_nombre: vars.clinic.name,
      clinica_telefono: vars.clinic.phone,
    },
  });

  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, callId: result.callId };
}
