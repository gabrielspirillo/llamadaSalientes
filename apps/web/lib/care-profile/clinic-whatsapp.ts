import 'server-only';

import { getConnectorForTenant } from '@/lib/whatsapp/factory';
import { sendAgentResponse } from '@/lib/whatsapp/outbound/send-response';
import { getOrCreateOpenConversation, upsertWhatsappContact } from '@/lib/whatsapp/persist';
import type { InteractiveButton } from '@/lib/whatsapp/types';

const CHANNEL = {
  whatsapp_cloud: 'WHATSAPP_CLOUD',
  whatsapp_twilio: 'WHATSAPP_TWILIO',
} as const;

/**
 * Manda mensajes de la clínica (guiones) a un teléfono y los deja en su chat
 * de la app como enviados por el equipo. Los botones van en el ÚLTIMO
 * mensaje. Devuelve false si no hay conector; los errores de envío suben.
 */
export async function sendClinicWhatsapp(
  tenantId: string,
  phoneE164: string,
  texts: string[],
  buttons?: InteractiveButton[],
): Promise<boolean> {
  const connector = await getConnectorForTenant(tenantId);
  if (!connector || texts.length === 0) return false;
  // Evolution (WhatsApp no oficial) acepta los botones pero WhatsApp no los
  // entrega: el mensaje no llega. Ahí van como opciones numeradas en el texto
  // y la respuesta ("1", "confirmar"…) la interpreta `handleDayOfTextReply`.
  let toSend = texts;
  let interactive = buttons;
  if (buttons?.length && connector.channel === 'whatsapp_evolution') {
    const last = texts.length - 1;
    const options = numberedOptions(buttons);
    toSend = texts.map((t, i) => (i === last ? `${t}\n\n${options}` : t));
    interactive = undefined;
  }
  const contact = await upsertWhatsappContact({ tenantId, phoneE164, name: null });
  const conversation = await getOrCreateOpenConversation({
    tenantId,
    contactId: contact.id,
    channel: CHANNEL[connector.channel as keyof typeof CHANNEL] ?? ('WHATSAPP_EVOLUTION' as const),
  });
  for (let i = 0; i < toSend.length; i++) {
    await sendAgentResponse({
      tenantId,
      conversationId: conversation.id,
      toPhoneE164: phoneE164,
      text: toSend[i] as string,
      buttons: i === toSend.length - 1 ? (interactive ?? null) : null,
      connector,
      senderType: 'HUMAN',
    });
  }
  return true;
}

const NUMBERS = ['1️⃣', '2️⃣', '3️⃣'];
export const OPTIONS_MARKER = 'Responde con el número';

function numberedOptions(buttons: InteractiveButton[]): string {
  return [
    `${OPTIONS_MARKER}:`,
    ...buttons.map((b, i) => `${NUMBERS[i] ?? `${i + 1}.`} ${b.title}`),
  ].join('\n');
}
