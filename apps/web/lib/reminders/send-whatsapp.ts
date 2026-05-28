import 'server-only';
import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  appointmentReminders,
  reminderMessageTemplates,
  whatsappConnections,
  whatsappContacts,
  whatsappMessages,
} from '@/lib/db/schema';
import { publishMessageEvent } from '@/lib/whatsapp/realtime/publisher';
import { buildConnector } from '@/lib/whatsapp/factory';
import { getOrCreateOpenConversation, upsertWhatsappContact } from '@/lib/whatsapp/persist';
import { sendAgentResponse } from '@/lib/whatsapp/outbound/send-response';
import {
  defaultReminderButtons,
  driverScopeForWhatsAppMode,
  resolveTemplate,
  type ReminderTemplateRow,
} from '@/lib/reminders/template-resolver';
import { interpolate, type ReminderVars } from '@/lib/reminders/variables';

// ─────────────────────────────────────────────────────────────────────────────
// Envío de un recordatorio por WhatsApp.
//
// Multi-driver:
//   - EVOLUTION → free-text interpolado + 3 botones quick-reply (reusa
//     sendAgentResponse para persistencia + idempotencia).
//   - CLOUD/TWILIO → plantilla aprobada Meta con params posicional + buttons
//     embedded en el template. Se persiste manualmente como type=TEMPLATE.
//     (Esta rama se implementa en PR-6; por ahora si no hay template
//     CLOUD/TWILIO devuelve error con reason='no_template').
//
// El persistido en `whatsapp_messages` permite que el recordatorio aparezca
// en el inbox como cualquier otro mensaje saliente.
// ─────────────────────────────────────────────────────────────────────────────

export type SendWhatsAppReminderResult =
  | {
      ok: true;
      externalMessageId: string;
      conversationId: string;
      kind: 'text' | 'buttons' | 'template';
    }
  | { ok: false; reason: string };

export async function sendWhatsAppReminder(args: {
  tenantId: string;
  reminderId: string;
  toPhoneE164: string;
  vars: ReminderVars;
  contactDisplayName: string | null;
}): Promise<SendWhatsAppReminderResult> {
  const { tenantId, reminderId, toPhoneE164, vars, contactDisplayName } = args;

  // Resolver conexión activa del tenant.
  const [conn] = await db
    .select()
    .from(whatsappConnections)
    .where(
      and(
        eq(whatsappConnections.tenantId, tenantId),
        eq(whatsappConnections.status, 'CONNECTED'),
      ),
    )
    .orderBy(desc(whatsappConnections.updatedAt))
    .limit(1);

  if (!conn) return { ok: false, reason: 'no_whatsapp_connection' };

  const driverScope = driverScopeForWhatsAppMode(conn.mode);

  // Cargar el reminder para saber qué rule + canal.
  const [rem] = await db
    .select({ ruleId: appointmentReminders.ruleId })
    .from(appointmentReminders)
    .where(eq(appointmentReminders.id, reminderId))
    .limit(1);
  if (!rem) return { ok: false, reason: 'reminder_not_found' };

  // Resolver template del (rule, canal=WHATSAPP, driverScope).
  const templates = await db
    .select()
    .from(reminderMessageTemplates)
    .where(
      and(
        eq(reminderMessageTemplates.ruleId, rem.ruleId),
        eq(reminderMessageTemplates.channel, 'WHATSAPP'),
      ),
    );

  const template = resolveTemplate(
    templates as ReminderTemplateRow[],
    'WHATSAPP',
    driverScope,
  );
  if (!template) return { ok: false, reason: 'no_template' };

  // Asegurar contact + conversation.
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

  const buttons =
    template.buttons.length > 0 ? template.buttons : defaultReminderButtons(reminderId);

  if (conn.mode === 'EVOLUTION') {
    // Free-text con botones interactivos.
    const body = template.freeText ? interpolate(template.freeText, vars) : '';
    if (!body.trim()) return { ok: false, reason: 'empty_body' };

    const connector = buildConnector(conn);
    try {
      const sent = await sendAgentResponse({
        tenantId,
        conversationId: conversation.id,
        toPhoneE164,
        text: body,
        buttons,
        connector,
      });
      return {
        ok: true,
        externalMessageId: sent.messageId,
        conversationId: conversation.id,
        kind: sent.kind,
      };
    } catch (err) {
      console.error('[send-whatsapp-reminder] evolution send failed', err);
      return { ok: false, reason: 'send_failed' };
    }
  }

  if (conn.mode === 'CLOUD' || conn.mode === 'TWILIO') {
    // Template Meta/Twilio: el envío se implementa en PR-6.
    if (!template.templateName) return { ok: false, reason: 'no_template' };
    try {
      const connector = buildConnector(conn);
      // mapParamsToValues: cada item del map referencia un path en vars o un literal.
      const params = template.templateParamsMap.map((p) => {
        if ('source' in p) return resolveOrEmpty(p.source, vars);
        if ('literal' in p) return p.literal;
        return '';
      });
      const sent = await connector.sendTemplate(toPhoneE164, template.templateName, {
        language: template.templateLanguage,
        body: params.map((v) => ({ type: 'text' as const, value: v })),
      });
      // Persistir manualmente (sendAgentResponse no soporta type=TEMPLATE).
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
            reminderId,
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
      console.error('[send-whatsapp-reminder] template send failed', err);
      return { ok: false, reason: 'send_failed' };
    }
  }

  return { ok: false, reason: 'unknown_mode' };
}

function resolveOrEmpty(path: string, vars: ReminderVars): string {
  // Usa el mismo resolver de variables.ts pero sin re-importar el path
  // explícito (lo replica para no exportar resolveVar dos veces; igual está
  // bien duplicar 4 líneas).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = vars;
  for (const raw of path.split('.')) {
    const camel = raw.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (cur == null || typeof cur !== 'object') return '';
    cur = cur[camel] ?? cur[raw];
  }
  return cur == null ? '' : String(cur);
}

// Contact display name helper (usado por el worker para pasar al sender).
export function deriveContactDisplayName(vars: ReminderVars): string | null {
  const full = vars.contact.fullName;
  if (full && full !== 'paciente') return full;
  return null;
}
