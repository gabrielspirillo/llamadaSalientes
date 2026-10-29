import 'server-only';

import { patientHasHistory } from '@/lib/agenda/first-visit';
import { getClinicTimezone } from '@/lib/agenda/queries';
import { bookingMessages } from '@/lib/care-profile/messages';
import { getCareProfileSafe } from '@/lib/care-profile/queries';
import { getPatientPerson, listPatientsForPhone } from '@/lib/patients/persons';
import { getConnectorForTenant } from '@/lib/whatsapp/factory';
import { sendAgentResponse } from '@/lib/whatsapp/outbound/send-response';
import { getOrCreateOpenConversation, upsertWhatsappContact } from '@/lib/whatsapp/persist';

export interface BookingForConfirmation {
  startsAt: Date;
  patientId: string | null;
  patientFirstName: string | null;
  isFirstVisit: boolean;
  timezone: string;
}

/**
 * Mensajes de la clínica tras una reserva (guion A o B), o [] si no tiene
 * guiones. Guion A sólo si el niño empieza de cero: primera visita y ningún
 * hermano del mismo teléfono vino antes. Nunca lanza.
 */
export async function clinicBookingMessages(
  tenantId: string,
  booked: BookingForConfirmation,
  phone: string | null | undefined,
): Promise<string[]> {
  try {
    const profile = await getCareProfileSafe(tenantId);
    if (!profile?.messageScripts) return [];
    let siblingCameBefore = false;
    if (booked.isFirstVisit && phone) {
      const kids = await listPatientsForPhone(tenantId, phone).catch(() => []);
      for (const k of kids) {
        if (k.id === booked.patientId) continue;
        if (await patientHasHistory(tenantId, { patientId: k.id }).catch(() => false)) {
          siblingCameBefore = true;
          break;
        }
      }
    }
    return bookingMessages(profile.messageScripts, {
      patientFirstName: booked.patientFirstName,
      startsAt: booked.startsAt,
      timezone: booked.timezone,
      isFirstVisit: booked.isFirstVisit,
      siblingCameBefore,
    });
  } catch (err) {
    console.warn('[booking-confirmation] guiones de reserva', (err as Error).message);
    return [];
  }
}

const CHANNEL = {
  whatsapp_cloud: 'WHATSAPP_CLOUD',
  whatsapp_twilio: 'WHATSAPP_TWILIO',
} as const;

/**
 * Cita dada desde el panel: la familia recibe por WhatsApp la misma
 * confirmación que si la hubiera reservado el asistente. Sin guiones, sin
 * teléfono, sin conector o con la cita ya pasada, no hace nada. Nunca lanza.
 */
export async function sendBookingConfirmation(appointment: {
  tenantId: string;
  startsAt: Date;
  patientId: string | null;
  patientName: string;
  patientPhone: string | null;
  isFirstVisit: boolean | null;
}): Promise<void> {
  try {
    const { tenantId } = appointment;
    if (!appointment.patientPhone || appointment.startsAt.getTime() < Date.now()) return;
    const person = appointment.patientId
      ? await getPatientPerson(tenantId, appointment.patientId).catch(() => null)
      : null;
    const messages = await clinicBookingMessages(
      tenantId,
      {
        startsAt: appointment.startsAt,
        patientId: appointment.patientId,
        patientFirstName:
          person?.firstName ?? (appointment.patientName.trim().split(/\s+/)[0] || null),
        isFirstVisit: appointment.isFirstVisit ?? false,
        timezone: await getClinicTimezone(tenantId),
      },
      appointment.patientPhone,
    );
    if (messages.length === 0) return;
    const connector = await getConnectorForTenant(tenantId);
    if (!connector) return;

    const contact = await upsertWhatsappContact({
      tenantId,
      phoneE164: appointment.patientPhone,
      name: null,
    });
    const conversation = await getOrCreateOpenConversation({
      tenantId,
      contactId: contact.id,
      channel:
        CHANNEL[connector.channel as keyof typeof CHANNEL] ?? ('WHATSAPP_EVOLUTION' as const),
    });
    for (const text of messages) {
      await sendAgentResponse({
        tenantId,
        conversationId: conversation.id,
        toPhoneE164: appointment.patientPhone,
        text,
        buttons: null,
        connector,
        senderType: 'HUMAN',
      });
    }
  } catch (err) {
    console.warn('[booking-confirmation] envío', (err as Error).message);
  }
}
