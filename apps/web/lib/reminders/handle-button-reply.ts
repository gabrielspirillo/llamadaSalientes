import 'server-only';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  appointmentReminders,
  reminderConfirmations,
  whatsappContacts,
  whatsappConversations,
} from '@/lib/db/schema';
import {
  removeReminderFallbackJob,
  removeReminderSendJob,
  sendQueueEvent,
} from '@/lib/queue/client';
import { cancelFollowingReminders } from '@/lib/reminders/cancel';
import { cancelAppointment } from '@/lib/retell/tools';

// ─────────────────────────────────────────────────────────────────────────────
// Procesamiento de button replies de WhatsApp para recordatorios.
//
// Los botones se generan con id `rem:<action>:<reminderId>` (ver
// template-resolver.defaultReminderButtons). Cuando el paciente toca uno, el
// inbound trae ese id. Acá lo matcheamos, registramos confirmación y
// transicionamos el estado del reminder.
// ─────────────────────────────────────────────────────────────────────────────

const BUTTON_RE = /^rem:(confirm|reschedule|cancel):([0-9a-f-]{8,})$/i;

export type ReminderButtonAction = 'confirm' | 'reschedule' | 'cancel';

export function parseReminderButtonId(
  buttonId: string | null | undefined,
): { action: ReminderButtonAction; reminderId: string } | null {
  if (!buttonId) return null;
  const m = BUTTON_RE.exec(buttonId);
  if (!m) return null;
  return {
    action: m[1]!.toLowerCase() as ReminderButtonAction,
    reminderId: m[2]!,
  };
}

// Intenta extraer el button_reply id según el payload `raw` y el canal.
// Cloud: raw.interactive.button_reply.id
// Evolution: raw.message.buttonsResponseMessage.selectedButtonId
//           o raw.message.templateButtonReplyMessage.selectedId
//           o raw.message.listResponseMessage.singleSelectReply.selectedRowId
// Twilio: por ahora no soportado (requiere correlación por last outbound).
export function extractInteractiveReplyId(
  raw: unknown,
  channel: 'WHATSAPP_CLOUD' | 'WHATSAPP_EVOLUTION' | 'WHATSAPP_TWILIO',
): string | null {
  if (raw == null || typeof raw !== 'object') return null;
  if (channel === 'WHATSAPP_CLOUD') {
    // raw es el CloudMessage normalizado (interactive opcional unknown).
    const interactive = (raw as { interactive?: unknown }).interactive;
    if (interactive && typeof interactive === 'object') {
      const br = (interactive as { button_reply?: { id?: string }; list_reply?: { id?: string } });
      return br.button_reply?.id ?? br.list_reply?.id ?? null;
    }
    return null;
  }
  if (channel === 'WHATSAPP_EVOLUTION') {
    // raw es payload.data de Evolution (key + message + ...).
    const message = (raw as { message?: Record<string, unknown> }).message;
    if (!message) return null;
    const btnResp = message.buttonsResponseMessage as { selectedButtonId?: string } | undefined;
    if (btnResp?.selectedButtonId) return btnResp.selectedButtonId;
    const tplResp = message.templateButtonReplyMessage as { selectedId?: string } | undefined;
    if (tplResp?.selectedId) return tplResp.selectedId;
    const listResp = message.listResponseMessage as
      | { singleSelectReply?: { selectedRowId?: string } }
      | undefined;
    if (listResp?.singleSelectReply?.selectedRowId) {
      return listResp.singleSelectReply.selectedRowId;
    }
    return null;
  }
  // Twilio: no soportado en v1.
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler central. Devuelve true si consumió el evento (no encolar wa-process).
// ─────────────────────────────────────────────────────────────────────────────

export async function handleReminderButtonReply(args: {
  tenantId: string;
  conversationId: string;
  contactPhoneE164: string;
  rawButtonId: string;
  inboundMessageId: string;
}): Promise<{ consumed: boolean; action?: ReminderButtonAction }> {
  const parsed = parseReminderButtonId(args.rawButtonId);
  if (!parsed) return { consumed: false };

  const { action, reminderId } = parsed;

  // Cargar reminder y validar tenant.
  const [rem] = await db
    .select()
    .from(appointmentReminders)
    .where(
      and(
        eq(appointmentReminders.tenantId, args.tenantId),
        eq(appointmentReminders.id, reminderId),
      ),
    )
    .limit(1);

  if (!rem) {
    // El id matcheaba el regex pero el reminder no existe (tenant equivocado /
    // borrado / botón muy viejo). No consumimos para que el flujo siga.
    return { consumed: false };
  }

  // Insertar confirmation (idempotente por composite logical: si ya hubo una
  // con misma action + source para este reminder, ignoramos. PG no permite
  // unique partial fácil aquí; chequeamos manualmente).
  const existing = await db
    .select({ id: reminderConfirmations.id })
    .from(reminderConfirmations)
    .where(
      and(
        eq(reminderConfirmations.reminderId, reminderId),
        eq(reminderConfirmations.action, action),
        eq(reminderConfirmations.source, 'button'),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    await db.insert(reminderConfirmations).values({
      tenantId: args.tenantId,
      reminderId,
      action,
      source: 'button',
      metadata: { buttonId: args.rawButtonId, inboundMessageId: args.inboundMessageId },
    });
  }

  // Transicionar status según action.
  if (action === 'confirm') {
    await db
      .update(appointmentReminders)
      .set({ status: 'CONFIRMED', respondedAt: new Date(), updatedAt: new Date() })
      .where(eq(appointmentReminders.id, reminderId));
    await Promise.all([
      removeReminderFallbackJob(reminderId),
      removeReminderSendJob(reminderId),
      cancelFollowingReminders({
        tenantId: args.tenantId,
        ghlAppointmentId: rem.ghlAppointmentId,
        excludeReminderId: reminderId,
      }),
    ]);
    return { consumed: true, action };
  }

  if (action === 'cancel') {
    await db
      .update(appointmentReminders)
      .set({ status: 'CANCELLED', respondedAt: new Date(), updatedAt: new Date() })
      .where(eq(appointmentReminders.id, reminderId));
    await Promise.all([
      removeReminderFallbackJob(reminderId),
      removeReminderSendJob(reminderId),
      cancelFollowingReminders({
        tenantId: args.tenantId,
        ghlAppointmentId: rem.ghlAppointmentId,
        excludeReminderId: reminderId,
      }),
    ]);
    // Best-effort cancel en GHL — reusa el tool ya existente.
    try {
      await cancelAppointment(args.tenantId, { appointment_id: rem.ghlAppointmentId });
    } catch (err) {
      console.warn('[reminder] cancelAppointment GHL failed', err);
    }
    return { consumed: true, action };
  }

  // action === 'reschedule'
  await db
    .update(appointmentReminders)
    .set({
      status: 'RESCHEDULE_REQUESTED',
      respondedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(appointmentReminders.id, reminderId));
  await removeReminderFallbackJob(reminderId);

  // Setear flag en la conversación para que el agente WA arranque proponiendo slots.
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min de ventana
  await db
    .update(whatsappConversations)
    .set({
      status: 'ACTIVE',
      aiEnabled: true,
      context: {
        remindersResume: {
          reminderId,
          action: 'reschedule',
          ghlAppointmentId: rem.ghlAppointmentId,
          expiresAt: expiresAt.toISOString(),
        },
      } as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(whatsappConversations.id, args.conversationId));

  // Encolar wa-process para que el agente entre en el próximo turn con el
  // contexto seteado.
  await sendQueueEvent('wa-process', {
    tenantId: args.tenantId,
    conversationId: args.conversationId,
    messageId: args.inboundMessageId,
    contactPhoneE164: args.contactPhoneE164,
  });

  // No "consumimos" del todo: el agente WA debe procesar la conversación
  // para iniciar la negociación. Pero el botón ya fue registrado; el caller
  // PUEDE elegir no encolar wa-process — lo hicimos nosotros adentro, así que
  // devolvemos consumed=true para que el caller no duplique encolado.
  return { consumed: true, action };
}

// Helper para los route handlers: dado un raw + canal, decide si el inbound
// fue un button reply de reminder y si lo consumimos.
export async function tryHandleReminderInbound(args: {
  tenantId: string;
  conversationId: string;
  contactPhoneE164: string;
  inboundMessageId: string;
  rawMessage: unknown;
  channel: 'WHATSAPP_CLOUD' | 'WHATSAPP_EVOLUTION' | 'WHATSAPP_TWILIO';
}): Promise<{ consumed: boolean; action?: ReminderButtonAction }> {
  const replyId = extractInteractiveReplyId(args.rawMessage, args.channel);
  if (!replyId) return { consumed: false };
  return handleReminderButtonReply({
    tenantId: args.tenantId,
    conversationId: args.conversationId,
    contactPhoneE164: args.contactPhoneE164,
    rawButtonId: replyId,
    inboundMessageId: args.inboundMessageId,
  });
}
