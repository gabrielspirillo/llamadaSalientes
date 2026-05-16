import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { whatsappContacts, whatsappConversations, whatsappMessages } from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';

import { MessageComposer } from '../_components/message-composer';
import { ConversationActions } from '../_components/conversation-actions';

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

  const messages = await db
    .select()
    .from(whatsappMessages)
    .where(eq(whatsappMessages.conversationId, row.conv.id))
    .orderBy(asc(whatsappMessages.createdAt))
    .limit(500);

  const channelLabel = row.conv.channel === 'WHATSAPP_CLOUD' ? 'Cloud API' : 'Evolution';

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/whatsapp"
              className="text-sm text-zinc-500 hover:text-zinc-700"
            >
              ← Conversaciones
            </Link>
          </div>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">
            {row.contact.name ?? row.contact.phoneE164}
          </h1>
          <p className="text-xs text-zinc-500">
            {row.contact.phoneE164} · {channelLabel} · Estado:{' '}
            <span className="font-medium text-zinc-700">{row.conv.status}</span>
            {row.conv.urgentFlag && (
              <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                URGENTE
              </span>
            )}
          </p>
        </div>
        <ConversationActions
          conversationId={row.conv.id}
          status={row.conv.status}
          urgentFlag={row.conv.urgentFlag}
        />
      </div>

      <div className="flex-1 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6">
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
                : 'mr-auto bg-zinc-100';
              return (
                <li
                  key={m.id}
                  className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm ${containerCls}`}
                >
                  {isInternal && (
                    <div className="mb-1 text-[10px] font-semibold uppercase text-amber-700">
                      Nota interna
                    </div>
                  )}
                  <div className="whitespace-pre-wrap">{m.contentText ?? `[${m.type}]`}</div>
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

      <MessageComposer conversationId={row.conv.id} disabled={row.conv.status === 'CLOSED'} />
    </div>
  );
}
