import 'server-only';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  waitlistMessageTemplates,
  whatsappConnections,
  whatsappMessages,
} from '@/lib/db/schema';
import { buildConnector } from '@/lib/whatsapp/factory';
import { getOrCreateOpenConversation, upsertWhatsappContact } from '@/lib/whatsapp/persist';
import { sendAgentResponse } from '@/lib/whatsapp/outbound/send-response';
import { publishMessageEvent } from '@/lib/whatsapp/realtime/publisher';
import { driverScopeForWhatsAppMode } from '@/lib/reminders/template-resolver';
import { resolveActiveConnection } from '@/lib/reminders/send-whatsapp';
import {
  defaultWaitlistButtons,
  resolveWaitlistTemplate,
} from '@/lib/waitlist/template-resolver';
import { interpolateWaitlist } from '@/lib/waitlist/variables';
import type { WaitlistTemplateRow, WaitlistVars } from '@/lib/waitlist/types';

// Envío de oferta waitlist por WhatsApp. Misma estrategia multi-driver que
// reminders. Reutiliza la conexión activa del tenant y el flujo de persistencia.

type WaConnRow = typeof whatsappConnections.$inferSelect;

export type SendWaitlistWhatsAppResult =
  | {
      ok: true;
      externalMessageId: string;
      conversationId: string;
      kind: 'text' | 'buttons' | 'template';
    }
  | { ok: false; reason: string };

export async function sendWaitlistWhatsApp(args: {
  tenantId: string;
  offerId: string;
  toPhoneE164: string;
  vars: WaitlistVars;
  contactDisplayName: string | null;
}): Promise<SendWaitlistWhatsAppResult> {
  const { tenantId, offerId, toPhoneE164, vars, contactDisplayName } = args;

  const conn = await resolveActiveConnection(tenantId);
  if (!conn) return { ok: false, reason: 'no_whatsapp_connection' };

  const driverScope = driverScopeForWhatsAppMode(conn.mode);

  const templates = await db
    .select()
    .from(waitlistMessageTemplates)
    .where(
      and(
        eq(waitlistMessageTemplates.tenantId, tenantId),
        eq(waitlistMessageTemplates.channel, 'WHATSAPP'),
      ),
    );

  const template = resolveWaitlistTemplate(
    templates as WaitlistTemplateRow[],
    'WHATSAPP',
    driverScope,
  );
  if (!template) return { ok: false, reason: 'no_template' };

  return sendWaitlistWhatsAppDirect({
    tenantId,
    conn,
    template,
    vars,
    toPhoneE164,
    contactDisplayName,
    offerId,
  });
}

export async function sendWaitlistWhatsAppDirect(args: {
  tenantId: string;
  conn: WaConnRow;
  template: WaitlistTemplateRow;
  vars: WaitlistVars;
  toPhoneE164: string;
  contactDisplayName: string | null;
  offerId: string;
}): Promise<SendWaitlistWhatsAppResult> {
  const { tenantId, conn, template, vars, toPhoneE164, contactDisplayName, offerId } = args;

  const contact = await upsertWhatsappContact({
    tenantId,
    phoneE164: toPhoneE164,
    name: contactDisplayName,
  });
  const conversation = await getOrCreateOpenConversation({
    tenantId,
    contactId: contact.id,
    channel:
      conn.mode === 'CLOUD'
        ? 'WHATSAPP_CLOUD'
        : conn.mode === 'TWILIO'
          ? 'WHATSAPP_TWILIO'
          : 'WHATSAPP_EVOLUTION',
  });

  const buttons = template.buttons.length > 0 ? template.buttons : defaultWaitlistButtons(offerId);

  if (conn.mode === 'EVOLUTION') {
    const body = template.freeText ? interpolateWaitlist(template.freeText, vars) : '';
    if (!body.trim()) return { ok: false, reason: 'empty_body' };
    void buttons;

    // OJO: NO usamos sendButtons. Evolution + Baileys lo enruta como
    // viewOnceMessage que no se entrega a muchos clientes WhatsApp (queda
    // PENDING). En su lugar mandamos texto plano con hints; el handler de
    // inbound (handle-text-reply) reconoce "acepto" / "no puedo" / "sí" / "no"
    // y resuelve la oferta.
    const bodyWithHints = `${body}\n\nResponde:\n• *Acepto* para tomar el hueco\n• *No puedo* si no te sirve`;
    const connector = buildConnector(conn);
    try {
      const sent = await sendAgentResponse({
        tenantId,
        conversationId: conversation.id,
        toPhoneE164,
        text: bodyWithHints,
        buttons: null,
        connector,
      });
      return {
        ok: true,
        externalMessageId: sent.messageId,
        conversationId: conversation.id,
        kind: sent.kind,
      };
    } catch (err) {
      const errMsg = (err as Error)?.message ?? String(err);
      console.error('[waitlist-send-wa] evolution sendText failed', errMsg);
      return { ok: false, reason: `evolution: ${errMsg}` };
    }
  }

  if (conn.mode === 'CLOUD' || conn.mode === 'TWILIO') {
    if (!template.templateName) return { ok: false, reason: 'no_template' };
    try {
      const connector = buildConnector(conn);
      const params = template.templateParamsMap.map((p) => {
        if ('source' in p) return resolveOrEmpty(p.source, vars);
        if ('literal' in p) return p.literal;
        return '';
      });
      const sent = await connector.sendTemplate(toPhoneE164, template.templateName, {
        language: template.templateLanguage,
        body: params.map((v) => ({ type: 'text' as const, value: v })),
      });
      const [inserted] = await db
        .insert(whatsappMessages)
        .values({
          tenantId,
          conversationId: conversation.id,
          externalId: sent.id,
          direction: 'OUTBOUND',
          type: 'TEMPLATE',
          senderType: 'AGENT',
          contentText: template.templateName,
          rawJson: {
            templateName: template.templateName,
            language: template.templateLanguage,
            params,
            buttons,
            offerId,
          } as never,
        })
        .onConflictDoNothing({
          target: [whatsappMessages.conversationId, whatsappMessages.externalId],
        })
        .returning();
      if (inserted) await publishMessageEvent(inserted);

      const messageRow =
        inserted ??
        (
          await db
            .select({ id: whatsappMessages.id })
            .from(whatsappMessages)
            .where(eq(whatsappMessages.externalId, sent.id))
            .limit(1)
        )[0];
      if (!messageRow) return { ok: false, reason: 'persist_failed' };

      return {
        ok: true,
        externalMessageId: messageRow.id,
        conversationId: conversation.id,
        kind: 'template',
      };
    } catch (err) {
      const errMsg = (err as Error)?.message ?? String(err);
      console.error('[waitlist-send-wa] template send failed', errMsg);
      return { ok: false, reason: `template: ${errMsg}` };
    }
  }

  return { ok: false, reason: 'unknown_mode' };
}

function resolveOrEmpty(path: string, vars: WaitlistVars): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = vars;
  for (const raw of path.split('.')) {
    const camel = raw.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (cur == null || typeof cur !== 'object') return '';
    cur = cur[camel] ?? cur[raw];
  }
  return cur == null ? '' : String(cur);
}

export function deriveContactDisplayNameFromWaitlistVars(vars: WaitlistVars): string | null {
  const full = vars.contact.fullName;
  if (full && full !== 'paciente') return full;
  return null;
}
