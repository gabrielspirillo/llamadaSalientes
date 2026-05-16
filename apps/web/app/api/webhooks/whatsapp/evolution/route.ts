import { type NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { auditLogs, whatsappConnections } from '@/lib/db/schema';
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
        try {
          await persistInboundMessage(inbound);
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
