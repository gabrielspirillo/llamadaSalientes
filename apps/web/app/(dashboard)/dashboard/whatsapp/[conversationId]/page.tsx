import { and, asc, eq, inArray } from 'drizzle-orm';
import { ArrowLeft, Zap } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/stat';

import { db } from '@/lib/db/client';
import {
  appointmentsCache,
  treatments,
  users,
  whatsappContacts,
  whatsappConversationTags,
  whatsappConversations,
  whatsappMessages,
  whatsappTags,
} from '@/lib/db/schema';
import { getLeadMemory } from '@/lib/memory/lead-memory';
import { getCurrentTenant } from '@/lib/tenant';
import { listTenantMembersSynced } from '@/lib/tenant-members';

import { ContactSidebar } from '../_components/contact-sidebar';
import { ConversationActions } from '../_components/conversation-actions';
import { MessageComposer } from '../_components/message-composer';
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

  // Marcar como leída al abrir: reseteamos el contador de no leídos. Solo
  // escribimos si hay algo que resetear, para no generar writes en cada render.
  if (row.conv.unreadCount > 0) {
    await db
      .update(whatsappConversations)
      .set({ unreadCount: 0 })
      .where(eq(whatsappConversations.id, row.conv.id));
  }

  // Memoria del lead (cross-canal) para mostrar en el sidebar. Best-effort.
  const leadMem = await getLeadMemory(tenant.id, row.contact.phoneE164).catch(() => null);

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
    : Promise.resolve(
        [] as Array<{ appt: typeof appointmentsCache.$inferSelect; treatmentName: string | null }>,
      );

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
    <div className="-mx-4 flex flex-col overflow-hidden rounded-none border-[--color-border] bg-white sm:mx-0 sm:rounded-[22px] sm:border sm:shadow-[var(--shadow-soft)] lg:h-[calc(100vh-9rem)] lg:flex-row">
      {/* Centro: cabecera + thread + composer */}
      <div className="flex h-[calc(100vh-9rem)] min-w-0 flex-1 flex-col lg:h-auto">
        <div className="flex items-center justify-between gap-3 border-b border-[--color-border-subtle] bg-white/80 px-4 py-3 backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/dashboard/whatsapp"
              aria-label="Volver a conversaciones"
              className="group inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-all duration-300 hover:bg-zinc-100 hover:text-brand-700"
            >
              <ArrowLeft className="h-4 w-4 transition-transform duration-300 group-hover:-translate-x-0.5" />
            </Link>
            <Avatar
              name={row.contact.name ?? row.contact.phoneE164}
              src={row.contact.avatarUrl}
              size={40}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-[19px] font-bold tracking-tight text-zinc-900">
                  {row.contact.name ?? row.contact.phoneE164}
                </h1>
                {row.conv.urgentFlag && (
                  <Badge tone="danger" size="sm" className="shrink-0 animate-pulse-soft">
                    URGENTE
                  </Badge>
                )}
              </div>
              <Link
                href="/dashboard/whatsapp/quick-replies"
                className="mt-0.5 inline-flex items-center gap-1 text-[14px] text-zinc-400 transition-colors hover:text-brand-600"
              >
                <Zap className="h-3 w-3" />
                Respuestas rápidas
              </Link>
            </div>
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

        <div className="border-t border-[--color-border-subtle] bg-white p-3">
          <MessageComposer conversationId={row.conv.id} disabled={row.conv.status === 'CLOSED'} />
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
        leadMemory={
          leadMem
            ? {
                profileSummary: leadMem.profileSummary,
                facts: leadMem.facts,
                updatedAt: leadMem.updatedAt.toISOString(),
              }
            : null
        }
      />
    </div>
  );
}
