import { desc, eq, sql } from 'drizzle-orm';
import { MessageCircle, Settings2 } from 'lucide-react';
import Link from 'next/link';

import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Avatar } from '@/components/ui/stat';
import { db } from '@/lib/db/client';
import { whatsappContacts, whatsappConversations, whatsappMessages } from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';

import { AutoRefresh } from './_components/auto-refresh';

export const dynamic = 'force-dynamic';

function relativeTime(d: Date | null | undefined): string {
  if (!d) return '—';
  const diffMs = Date.now() - d.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const day = Math.round(hr / 24);
  return `hace ${day} d`;
}

// Badge calculado del estado EFECTIVO (coincide con el toggle "Agente
// Virtual" del detalle): la IA está activa salvo que esté pausada
// (aiEnabled=false) o haya una ventana de takeover del operador vigente.
function statusBadge(conv: {
  status: 'ACTIVE' | 'HANDOFF' | 'CLOSED';
  aiEnabled: boolean;
  humanTakeoverUntil: Date | null;
}): { label: string; tone: 'neutral' | 'warn' | 'success' } {
  if (conv.status === 'CLOSED') {
    return { label: 'Cerrada', tone: 'neutral' };
  }
  const takeoverActive =
    !!conv.humanTakeoverUntil && conv.humanTakeoverUntil.getTime() > Date.now();
  if (!conv.aiEnabled || takeoverActive) {
    return { label: 'Operador', tone: 'warn' };
  }
  return { label: 'Agente IA', tone: 'success' };
}

function channelLabel(channel: string): string {
  return channel === 'WHATSAPP_CLOUD'
    ? 'Cloud API'
    : channel === 'WHATSAPP_TWILIO'
      ? 'Twilio'
      : 'Evolution';
}

export default async function WhatsappConversationsPage() {
  const { tenant } = await getCurrentTenant();

  const rows = await db
    .select({
      id: whatsappConversations.id,
      status: whatsappConversations.status,
      channel: whatsappConversations.channel,
      lastMsgAt: whatsappConversations.lastMsgAt,
      urgentFlag: whatsappConversations.urgentFlag,
      aiEnabled: whatsappConversations.aiEnabled,
      humanTakeoverUntil: whatsappConversations.humanTakeoverUntil,
      unreadCount: whatsappConversations.unreadCount,
      contactName: whatsappContacts.name,
      contactPhone: whatsappContacts.phoneE164,
    })
    .from(whatsappConversations)
    .innerJoin(whatsappContacts, eq(whatsappContacts.id, whatsappConversations.contactId))
    .where(eq(whatsappConversations.tenantId, tenant.id))
    // Orden por última actividad. Usamos coalesce(lastMsgAt, createdAt) para
    // que las conversaciones sin lastMsgAt no queden arriba (Postgres pone
    // NULLS FIRST en DESC por default → ese era el bug del orden).
    .orderBy(
      desc(sql`coalesce(${whatsappConversations.lastMsgAt}, ${whatsappConversations.createdAt})`),
    )
    .limit(100);

  // Preview: último mensaje de cada conversación en UNA query.
  //
  // Antes era un Promise.all con una query por conversación: hasta 101 queries
  // por render, y la página se auto-refresca, así que eran ~750 queries por
  // minuto y por operador con la bandeja abierta. `DISTINCT ON` resuelve lo
  // mismo de una, apoyado en whatsapp_messages_conv_created_idx.
  const conversationIds = rows.map((r) => r.id);
  const previewMap = new Map<
    string,
    { contentText: string | null; direction: string; createdAt: Date } | null
  >();

  if (conversationIds.length > 0) {
    const previews = await db.execute<{
      conversation_id: string;
      content_text: string | null;
      direction: string;
      created_at: Date;
    }>(sql`
      SELECT DISTINCT ON (m.conversation_id)
        m.conversation_id, m.content_text, m.direction, m.created_at
      FROM whatsapp_messages m
      WHERE m.conversation_id IN ${conversationIds}
      ORDER BY m.conversation_id, m.created_at DESC
    `);

    for (const p of previews) {
      previewMap.set(p.conversation_id, {
        contentText: p.content_text,
        direction: p.direction,
        createdAt: new Date(p.created_at),
      });
    }
  }

  const unreadTotal = rows.reduce((acc, r) => acc + (r.unreadCount ?? 0), 0);

  return (
    <div className="flex flex-col">
      {/* Refresca la lista para reordenar y mostrar mensajes nuevos sin
          recargar a mano (la página es server-render). A 8s cada refresco
          re-ejecutaba las queries del listado completo: es un intervalo de
          polling, no de tiempo real — para eso está el SSE del hilo. */}
      <AutoRefresh intervalMs={30000} />

      <PageHeader
        eyebrow="Bandeja de entrada"
        icon={<MessageCircle className="h-5 w-5" />}
        title="WhatsApp"
        description={
          rows.length > 0
            ? `${rows.length} conversaciones · ${unreadTotal} sin leer`
            : 'Conversaciones que atiende tu agente por WhatsApp.'
        }
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/dashboard/configuration?tab=whatsapp">
              <Settings2 className="h-4 w-4" /> Configurar
            </Link>
          </Button>
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MessageCircle className="h-5 w-5" />}
            title="Aún no hay conversaciones"
            description="Configura una conexión de WhatsApp para empezar a recibir mensajes."
            action={
              <Button asChild size="sm">
                <Link href="/dashboard/configuration?tab=whatsapp">Configurar WhatsApp</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="stagger divide-y divide-[--color-border-subtle]">
            {rows.map((r, i) => {
              const badge = statusBadge(r);
              const preview = previewMap.get(r.id);
              const name = r.contactName ?? r.contactPhone;
              const unread = r.unreadCount > 0;
              return (
                <li key={r.id} style={{ ['--i' as string]: Math.min(i, 14) }}>
                  <Link
                    href={`/dashboard/whatsapp/${r.id}`}
                    className={`group flex items-start gap-3 p-4 transition-colors duration-200 hover:bg-zinc-50 sm:px-5 ${
                      unread ? 'bg-emerald-50/30' : ''
                    }`}
                  >
                    <div className="relative shrink-0">
                      <Avatar name={name} size={42} />
                      {unread && (
                        <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-emerald-500 px-1 text-[11px] font-bold text-white ring-2 ring-white">
                          {r.unreadCount > 99 ? '99+' : r.unreadCount}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <p
                            className={`truncate text-[15px] ${
                              unread
                                ? 'font-extrabold text-zinc-900'
                                : 'font-semibold text-zinc-800'
                            }`}
                          >
                            {name}
                          </p>
                          {r.urgentFlag && (
                            <Badge tone="danger" size="sm" className="shrink-0 animate-pulse-soft">
                              URGENTE
                            </Badge>
                          )}
                        </div>
                        <span className="shrink-0 text-[12px] text-zinc-500">
                          {relativeTime(r.lastMsgAt)}
                        </span>
                      </div>

                      <p
                        className={`mt-0.5 line-clamp-1 text-[14px] ${
                          unread ? 'text-zinc-700' : 'text-zinc-500'
                        }`}
                      >
                        {preview?.direction === 'OUTBOUND' && (
                          <span className="text-zinc-400">Tú: </span>
                        )}
                        {preview?.contentText ?? '—'}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                        <span className="rounded-lg bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-500">
                          {channelLabel(r.channel)}
                        </span>
                        <span className="hidden text-[12px] tabular-nums text-zinc-500 sm:inline">
                          {r.contactPhone}
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
