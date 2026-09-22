import 'server-only';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { whatsappConversations } from '@/lib/db/schema';
import { formatDerivationBrief } from '@/lib/whatsapp/agent/derivation';
import type { AgentDerivation } from '@/lib/whatsapp/agent/types';
import { getConnectorForTenant } from '@/lib/whatsapp/factory';
import { sendAgentResponse } from '@/lib/whatsapp/outbound/send-response';
import { getOrCreateOpenConversation, upsertWhatsappContact } from '@/lib/whatsapp/persist';
import type { WhatsAppConnector } from '@/lib/whatsapp/types';

/**
 * El aviso que recibe el profesional cuando el asistente le pasa una consulta
 * (modo DERIVE).
 *
 * Sale por el mismo WhatsApp de la clínica, así que el profesional recibe el
 * parte de un número que ya conoce. Eso tiene una consecuencia que hay que
 * atender: su respuesta entra al inbox como una conversación más. Por eso el
 * hilo del profesional queda con el agente APAGADO — si no, el asistente le
 * contestaría a él como si fuera un paciente.
 *
 * Nunca lanza: una consulta ya derivada no se puede perder porque el móvil del
 * profesional esté mal escrito. Si el aviso no sale, quedan la tarea y la
 * tarjeta en el chat interno, que es lo que el equipo mira.
 */
export interface NotifyProfessionalResult {
  sent: boolean;
  reason?: string;
  messageId?: string;
}

export async function notifyProfessionalOfDerivation(input: {
  tenantId: string;
  clinicName: string;
  derivation: AgentDerivation;
  /** Se inyecta en los tests; en producción lo resuelve el tenant. */
  connector?: WhatsAppConnector | null;
}): Promise<NotifyProfessionalResult> {
  const { tenantId, derivation } = input;
  const to = derivation.phoneE164;
  if (!to) return { sent: false, reason: 'sin_destinatario' };
  if (to === derivation.patientPhoneE164) {
    // Un móvil mal cargado que coincide con el del paciente le mandaría el
    // parte clínico a él mismo. No hay mensaje que valga ese riesgo.
    return { sent: false, reason: 'destinatario_es_el_paciente' };
  }

  const connector = input.connector ?? (await getConnectorForTenant(tenantId));
  if (!connector) return { sent: false, reason: 'sin_conector' };

  const text = formatDerivationBrief({
    clinicName: input.clinicName,
    patientName: derivation.patientName,
    patientPhoneE164: derivation.patientPhoneE164,
    summary: derivation.summary,
    treatmentName: derivation.treatmentName,
    preferredTime: derivation.preferredTime,
    urgent: derivation.urgent,
    professionalName: derivation.professionalName,
    viaFallback: derivation.via === 'respaldo',
  });

  const conversationId = await conversacionDelProfesional({
    tenantId,
    phoneE164: to,
    name: derivation.professionalName,
    channel: channelOf(connector),
  });

  const sent = await sendAgentResponse({
    tenantId,
    conversationId,
    toPhoneE164: to,
    text,
    connector,
  });

  return { sent: true, messageId: sent.messageId };
}

/**
 * El hilo por el que se le escribe al profesional, con el asistente apagado.
 *
 * Se apaga en cada aviso y no sólo al crearlo: el hilo pudo existir de antes
 * (el profesional es también paciente de la casa, o alguien lo reactivó desde
 * el inbox) y dejarlo encendido es lo que haría que el agente se pusiera a
 * atender a su propio compañero.
 */
async function conversacionDelProfesional(input: {
  tenantId: string;
  phoneE164: string;
  name: string | null;
  channel: 'WHATSAPP_CLOUD' | 'WHATSAPP_EVOLUTION' | 'WHATSAPP_TWILIO';
}): Promise<string> {
  const contact = await upsertWhatsappContact({
    tenantId: input.tenantId,
    phoneE164: input.phoneE164,
    name: input.name,
  });

  const conversation = await getOrCreateOpenConversation({
    tenantId: input.tenantId,
    contactId: contact.id,
    channel: input.channel,
  });

  await db
    .update(whatsappConversations)
    .set({ aiEnabled: false, updatedAt: new Date() })
    .where(
      and(
        eq(whatsappConversations.tenantId, input.tenantId),
        eq(whatsappConversations.id, conversation.id),
      ),
    );

  return conversation.id;
}

function channelOf(
  connector: WhatsAppConnector,
): 'WHATSAPP_CLOUD' | 'WHATSAPP_EVOLUTION' | 'WHATSAPP_TWILIO' {
  switch (connector.channel) {
    case 'whatsapp_cloud':
      return 'WHATSAPP_CLOUD';
    case 'whatsapp_twilio':
      return 'WHATSAPP_TWILIO';
    default:
      return 'WHATSAPP_EVOLUTION';
  }
}
