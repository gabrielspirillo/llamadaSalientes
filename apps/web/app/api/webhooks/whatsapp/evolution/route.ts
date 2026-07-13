import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db/client';
import { auditLogs, whatsappConnections } from '@/lib/db/schema';
import { sendQueueEvent } from '@/lib/queue/client';
import { tryHandleReminderInbound } from '@/lib/reminders/handle-button-reply';
import { tryHandleWaitlistInbound } from '@/lib/waitlist/handle-button-reply';
import { tryHandleWaitlistTextReply } from '@/lib/waitlist/handle-text-reply';
import {
  evolutionMessagesUpsertSchema,
  normalizeEvolutionMessage,
  persistInboundMessage,
} from '@/lib/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface EvolutionEventBase {
  event: string;
  instance?: string;
  data?: Record<string, unknown>;
}

type WhatsappStatus = 'PENDING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

function statusFromConnection(state: unknown): WhatsappStatus {
  if (typeof state !== 'string') return 'PENDING';
  const s = state.toLowerCase();
  if (s === 'open' || s === 'connected') return 'CONNECTED';
  if (s === 'close' || s === 'disconnected') return 'DISCONNECTED';
  if (s === 'qrcode' || s === 'connecting') return 'PENDING';
  return 'ERROR';
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let event: EvolutionEventBase;
  try {
    event = (await req.json()) as EvolutionEventBase;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const instance = event.instance;
  if (!instance) {
    return NextResponse.json({ error: 'missing instance' }, { status: 400 });
  }

  const conns = await db
    .select()
    .from(whatsappConnections)
    .where(
      and(
        eq(whatsappConnections.evolutionInstance, instance),
        eq(whatsappConnections.mode, 'EVOLUTION'),
      ),
    )
    .limit(1);
  const conn = conns[0];
  if (!conn) {
    console.warn('[wa-evolution-webhook] instancia desconocida (ninguna conexión EVOLUTION matchea)', {
      instance,
      event: event.event,
    });
    return NextResponse.json({ ok: true, ignored: 'unknown_instance' });
  }

  try {
    switch (event.event) {
      case 'qrcode.updated':
      case 'QRCODE_UPDATED': {
        const qr = event.data as { qrcode?: { base64?: string }; base64?: string } | undefined;
        const qrB64 = qr?.qrcode?.base64 ?? qr?.base64 ?? null;
        await db
          .update(whatsappConnections)
          .set({ qrB64, status: 'PENDING', updatedAt: new Date() })
          .where(eq(whatsappConnections.id, conn.id));
        break;
      }
      case 'connection.update':
      case 'CONNECTION_UPDATE': {
        const data = event.data as { state?: string; status?: string } | undefined;
        const next = statusFromConnection(data?.state ?? data?.status);
        await db
          .update(whatsappConnections)
          .set(
            next === 'CONNECTED'
              ? { status: next, qrB64: null, updatedAt: new Date() }
              : { status: next, updatedAt: new Date() },
          )
          .where(eq(whatsappConnections.id, conn.id));

        try {
          await db.insert(auditLogs).values({
            tenantId: conn.tenantId,
            actorUserId: null,
            action: 'wa_evolution_connection_update',
            entity: 'whatsapp_connection',
            entityId: conn.id,
            after: { state: data?.state ?? data?.status ?? null, mapped: next } as never,
          });
        } catch (auditErr) {
          console.error('audit_failed', auditErr);
        }
        break;
      }
      case 'messages.upsert':
      case 'MESSAGES_UPSERT': {
        // ── Log de diagnóstico @lid ──────────────────────────────────────────
        // Volcamos la `key` cruda con los campos alternativos (remoteJidAlt /
        // senderPn / addressingMode) ANTES de normalizar, para ver cómo llega
        // realmente el remoteJid. WhatsApp entrega a veces "<id>@lid" (Android /
        // dispositivos vinculados) donde el número previo al @ NO es el teléfono.
        // Si remoteJid llega "@lid" y remoteJidAlt/senderPn vienen vacíos, ese
        // es el motivo por el que el bot no puede responder.
        const rawData = (event.data ?? {}) as {
          key?: Record<string, unknown>;
          senderPn?: unknown;
          pushName?: unknown;
          messageType?: unknown;
        };
        const rawKey = (rawData.key ?? {}) as Record<string, unknown>;
        const remoteJidRaw = typeof rawKey.remoteJid === 'string' ? rawKey.remoteJid : null;
        console.log('[wa-evolution-webhook] messages.upsert recibido', {
          instance,
          tenantId: conn.tenantId,
          remoteJid: remoteJidRaw,
          remoteJidAlt: rawKey.remoteJidAlt ?? null,
          participant: rawKey.participant ?? null,
          participantAlt: rawKey.participantAlt ?? null,
          addressingMode: rawKey.addressingMode ?? null,
          senderPn: rawData.senderPn ?? null,
          fromMe: rawKey.fromMe ?? null,
          pushName: rawData.pushName ?? null,
          messageType: rawData.messageType ?? null,
          esLid: remoteJidRaw?.includes('@lid') ?? false,
        });

        const parsed = evolutionMessagesUpsertSchema.safeParse(event);
        if (!parsed.success) {
          console.warn('[wa-evolution-webhook] messages.upsert no matchea schema', {
            errors: parsed.error.flatten().fieldErrors,
          });
          break;
        }
        // Filtramos outbound (fromMe=true) para no procesar nuestros propios envíos.
        if (parsed.data.data.key.fromMe) break;
        const inbound = normalizeEvolutionMessage(parsed.data, conn.tenantId);
        // Comparación crudo → normalizado: si el remoteJid es "@lid" y el
        // fromPhoneE164 quedó como un "+<id_lid>" (número inexistente), acá se
        // ve el bug que impide responder.
        console.log('[wa-evolution-webhook] mensaje normalizado', {
          remoteJid: parsed.data.data.key.remoteJid,
          fromPhoneE164: inbound.fromPhoneE164,
          type: inbound.type,
          contactName: inbound.contactName,
        });
        try {
          const persisted = await persistInboundMessage(inbound);
          if (persisted.message) {
            const waitlistButtonResult = await tryHandleWaitlistInbound({
              tenantId: conn.tenantId,
              rawMessage: parsed.data.data,
              channel: 'WHATSAPP_EVOLUTION',
            }).catch((err) => {
              console.warn('[wa-evolution-webhook] waitlist button handler failed', err);
              return { consumed: false } as const;
            });

            const waitlistTextResult = waitlistButtonResult.consumed
              ? ({ consumed: true } as const)
              : await tryHandleWaitlistTextReply({
                  tenantId: conn.tenantId,
                  contactPhoneE164: persisted.contact.phoneE164,
                  text: persisted.message.contentText,
                }).catch((err) => {
                  console.warn('[wa-evolution-webhook] waitlist text handler failed', err);
                  return { consumed: false } as const;
                });

            const waitlistResult = {
              consumed: waitlistButtonResult.consumed || waitlistTextResult.consumed,
            };

            const reminderResult = waitlistResult.consumed
              ? ({ consumed: true } as const)
              : await tryHandleReminderInbound({
                  tenantId: conn.tenantId,
                  conversationId: persisted.conversation.id,
                  contactPhoneE164: persisted.contact.phoneE164,
                  inboundMessageId: persisted.message.id,
                  rawMessage: parsed.data.data,
                  channel: 'WHATSAPP_EVOLUTION',
                }).catch((err) => {
                  console.warn('[wa-evolution-webhook] reminder reply handler failed', err);
                  return { consumed: false } as const;
                });
            if (!reminderResult.consumed) {
              await sendQueueEvent('wa-process', {
                tenantId: conn.tenantId,
                conversationId: persisted.conversation.id,
                messageId: persisted.message.id,
                contactPhoneE164: persisted.contact.phoneE164,
              });
            }
          }
        } catch (err) {
          console.error('[wa-evolution-webhook] persistInboundMessage failed', {
            err: (err as Error).message,
          });
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error('[wa-evolution-webhook] processing error', { err: (err as Error).message });
    return NextResponse.json({ error: 'processing error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
