import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  appointmentsCache,
  treatments,
  users,
  whatsappContacts,
  whatsappConversations,
  whatsappConversationTags,
  whatsappMessages,
  whatsappTags,
} from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';
import { listTenantMembersSynced } from '@/lib/tenant-members';

import { MessageComposer } from '../_components/message-composer';
import { ConversationActions } from '../_components/conversation-actions';
import { ContactSidebar } from '../_components/contact-sidebar';
import { MessagesStream } from '../_components/messages-stream';

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

  // Citas del contacto: lectura optimista del cache local. Si el contact aún
  // no tiene ghl_contact_id (sync GHL no corrió todavía) devolvemos []
  // sin tocar la BD.
  const apptsPromise = row.contact.ghlContactId
    ? db
        .select({
          appt: appointmentsCache,
          treatmentName: treatments.name,
        })
        .from(appointmentsCache)
        .leftJoin(treatments, eq(appointmentsCache.treatmentId, treatments.id))
        .where(
          and(
            eq(appointmentsCache.tenantId, tenant.id),
            eq(appointmentsCache.contactId, row.contact.ghlContactId),
          ),
        )
        .orderBy(asc(appointmentsCache.startTime))
        .limit(10)
    : Promise.resolve([] as Array<{ appt: typeof appointmentsCache.$inferSelect; treatmentName: string | null }>);

  const [messages, allTags, convTagRows, membersRows, apptRows] = await Promise.all([
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
    listTenantMembersSynced(tenant.id, tenant.clerkOrganizationId),
    apptsPromise,
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
    <div className="flex h-[calc(100vh-7.5rem)] -mx-4 sm:mx-0">
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

        <MessagesStream
          conversationId={row.conv.id}
          initialMessages={messages.map((m) => ({
            id: m.id,
            conversationId: m.conversationId,
            direction: m.direction as 'INBOUND' | 'OUTBOUND',
            type: m.type,
            senderType: m.senderType,
            senderUserId: m.senderUserId,
            internalNote: m.internalNote,
            contentText: m.contentText,
            mediaUrl: m.mediaUrl,
            mediaType: m.mediaType,
            deliveryStatus: m.deliveryStatus,
            createdAt: m.createdAt.toISOString(),
          }))}
          senderUserEmails={Object.fromEntries(senderUserMap)}
        />

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
          id: row.contact.id,
          name: row.contact.name,
          phoneE164: row.contact.phoneE164,
          ghlContactId: row.contact.ghlContactId,
          avatarUrl: row.contact.avatarUrl,
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
        appointments={apptRows.map((r) => ({
          id: r.appt.ghlAppointmentId,
          startTime: r.appt.startTime ? r.appt.startTime.toISOString() : null,
          status: r.appt.status,
          treatment: r.treatmentName,
        }))}
        tagsAll={allTags}
        tagsOnConversation={tagsOnConversation}
        members={membersRows}
      />
    </div>
  );
}
