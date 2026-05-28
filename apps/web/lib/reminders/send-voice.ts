import 'server-only';
import { triggerCallback } from '@/lib/calls/trigger-callback';
import type { ReminderVars } from '@/lib/reminders/variables';

// Envía un recordatorio por voz disparando una llamada Retell con
// `useCase='reminder'` y variables dinámicas con datos de la cita.
//
// El agente outbound (DentalVoice — Outbound) ya soporta este useCase y lee
// las variables del Retell LLM context. La idea es que el prompt outbound
// detecte `use_case === 'reminder'` y arranque con un mensaje del tipo
// "Hola {patient_name}, te llamo para recordarte tu cita de {tratamiento}…".

export async function sendVoiceReminder(args: {
  tenantId: string;
  reminderId: string;
  toPhoneE164: string;
  vars: ReminderVars;
  contactDisplayName: string | null;
  appointmentContactId: string | null;
}): Promise<{ ok: true; callId: string } | { ok: false; reason: string }> {
  const { tenantId, reminderId, toPhoneE164, vars, contactDisplayName, appointmentContactId } =
    args;

  const result = await triggerCallback({
    tenantId,
    toNumber: toPhoneE164,
    patientName: contactDisplayName,
    ghlContactId: appointmentContactId ?? null,
    source: 'reminder',
    useCase: 'reminder',
    createContactIfMissing: false,
    dynamicVars: {
      reminder_id: reminderId,
      fecha_cita: vars.appointment.date,
      hora_cita: vars.appointment.time,
      fecha_hora_cita: vars.appointment.dateTime,
      tratamiento: vars.appointment.treatment,
      tratamiento_duracion: vars.appointment.durationMinutes,
      paciente_nombre: vars.contact.firstName || vars.contact.fullName,
      clinica_nombre: vars.clinic.name,
      clinica_telefono: vars.clinic.phone,
      clinica_direccion: vars.clinic.address,
    },
  });

  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  return { ok: true, callId: result.callId };
}
