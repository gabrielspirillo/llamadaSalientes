import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  tenantMemberships,
  users,
  whatsappContacts,
  whatsappConversations,
  whatsappConversationTags,
  whatsappMessages,
  whatsappTags,
} from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';

import { MessageComposer } from '../_components/message-composer';
import { ConversationActions } from '../_components/conversation-actions';
import { ContactSidebar } from '../_components/contact-sidebar';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ conversationId: string }>;
}

export default async function WhatsappConversationDetailPage({ params }: Props) {
  const { conversationId } = await params;
  const { tenant } = await getCurrentTenant();

  const convRows = await db
    .select({
      conv: whatsappConversations,
      contact: whatsappContacts,
    })
    .from(whatsappConversations)
    .innerJoin(whatsappContacts, eq(whatsappContacts.id, whatsappConversations.contactId))
    .where(
      and(
        eq(whatsappConversations.id, conversationId),
        eq(whatsappConversations.tenantId, tenant.id),
      ),
    )
    .limit(1);
  const row = convRows[0];
  if (!row) notFound();

  const [messages, allTags, convTagRows, membersRows] = await Promise.all([
    db
      .select()
      .from(whatsappMessages)
      .where(eq(whatsappMessages.conversationId, row.conv.id))
      .orderBy(asc(whatsappMessages.createdAt))
      .limit(500),
    db
      .select({ id: whatsappTags.id, label: whatsappTags.label, color: whatsappTags.color })
      .from(whatsappTags)
      .where(eq(whatsappTags.tenantId, tenant.id))
      .orderBy(asc(whatsappTags.label)),
    db
      .select({ tagId: whatsappConversationTags.tagId })
      .from(whatsappConversationTags)
      .where(eq(whatsappConversationTags.conversationId, row.conv.id)),
    db
      .select({
        userId: users.id,
        email: users.email,
        role: tenantMemberships.role,
      })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(eq(tenantMemberships.tenantId, tenant.id))
      .orderBy(asc(users.email)),
  ]);

  const tagIdsOnConv = convTagRows.map((r) => r.tagId);
  const tagsOnConversation = tagIdsOnConv.length
    ? allTags.filter((t) => tagIdsOnConv.includes(t.id))
    : [];

  // Cargar emails de los autores (HUMAN senderUserId) en una sola consulta.
  const senderUserIds = Array.from(
    new Set(messages.map((m) => m.senderUserId).filter((x): x is string => Boolean(x))),
  );
  const senderUserMap = new Map<string, string>();
  if (senderUserIds.length > 0) {
    const senderRows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.id, senderUserIds));
    for (const u of senderRows) senderUserMap.set(u.id, u.email);
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Centro: cabecera + thread + composer */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <Link
                href="/dashboard/whatsapp"
                className="text-sm text-zinc-500 hover:text-zinc-700"
              >
                ← Conversaciones
              </Link>
              <Link
                href="/dashboard/whatsapp/quick-replies"
                className="ml-2 text-xs text-zinc-400 hover:text-zinc-600"
              >
                Respuestas rápidas
              </Link>
            </div>
            <h1 className="mt-1 truncate text-xl font-semibold text-zinc-900">
              {row.contact.name ?? row.contact.phoneE164}
            </h1>
            {row.conv.urgentFlag && (
              <span className="mt-1 inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                URGENTE
              </span>
            )}
          </div>
          <ConversationActions
            conversationId={row.conv.id}
            status={row.conv.status}
            urgentFlag={row.conv.urgentFlag}
          />
        </div>

        <div className="flex-1 overflow-y-auto bg-zinc-50 p-4">
          {messages.length === 0 ? (
            <p className="text-center text-sm text-zinc-500">Sin mensajes aún.</p>
          ) : (
            <ul className="space-y-2">
              {messages.map((m) => {
                const isOutbound = m.direction === 'OUTBOUND';
                const isInternal = m.internalNote;
                const containerCls = isInternal
                  ? 'mx-auto bg-amber-50 border border-amber-200'
                  : isOutbound
                    ? 'ml-auto bg-emerald-500 text-white'
                    : 'mr-auto bg-white border border-zinc-200';
                const authorEmail = m.senderUserId ? senderUserMap.get(m.senderUserId) : null;
                return (
                  <li
                    key={m.id}
                    className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm ${containerCls}`}
                  >
                    {isInternal && (
                      <div className="mb-1 text-[10px] font-semibold uppercase text-amber-700">
                        Nota interna{authorEmail ? ` · ${authorEmail}` : ''}
                      </div>
                    )}
                    {!isInternal && isOutbound && authorEmail && (
                      <div className="mb-0.5 text-[10px] font-medium text-emerald-100">
                        {authorEmail}
                      </div>
                    )}
                    {m.mediaUrl && m.type === 'IMAGE' && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.mediaUrl}
                        alt="adjunto"
                        className="mb-1 max-h-72 rounded-lg"
                      />
                    )}
                    {m.mediaUrl && m.type === 'AUDIO' && (
                      <audio src={m.mediaUrl} controls className="mb-1 w-full" />
                    )}
                    {m.mediaUrl && m.type === 'VIDEO' && (
                      <video src={m.mediaUrl} controls className="mb-1 max-h-72 rounded-lg" />
                    )}
                    {m.mediaUrl && m.type === 'PDF' && (
                      <a
                        href={m.mediaUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`mb-1 inline-flex items-center gap-1 underline ${
                          isOutbound ? 'text-emerald-50' : 'text-emerald-700'
                        }`}
                      >
                        📎 Ver documento
                      </a>
                    )}
                    <div className="whitespace-pre-wrap">
                      {m.contentText ?? (m.mediaUrl ? '' : `[${m.type}]`)}
                    </div>
                    <div
                      className={`mt-1 flex items-center gap-2 text-[10px] ${
                        isOutbound && !isInternal ? 'text-emerald-100' : 'text-zinc-500'
                      }`}
                    >
                      <span>{new Date(m.createdAt).toLocaleString()}</span>
                      {isOutbound && m.deliveryStatus && (
                        <span className="uppercase">{m.deliveryStatus}</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-zinc-200 bg-white p-3">
          <MessageComposer
            conversationId={row.conv.id}
            disabled={row.conv.status === 'CLOSED'}
          />
        </div>
      </div>

      <ContactSidebar
        conversationId={row.conv.id}
        contact={{
          name: row.contact.name,
          phoneE164: row.contact.phoneE164,
          ghlContactId: row.contact.ghlContactId,
          createdAt: row.contact.createdAt,
        }}
        conversation={{
          channel: row.conv.channel,
          status: row.conv.status,
          aiEnabled: row.conv.aiEnabled,
          assignedUserId: row.conv.assignedUserId,
          lastMsgAt: row.conv.lastMsgAt,
          humanTakeoverUntil: row.conv.humanTakeoverUntil,
        }}
        tagsAll={allTags}
        tagsOnConversation={tagsOnConversation}
        members={membersRows}
      />
    </div>
  );
}
