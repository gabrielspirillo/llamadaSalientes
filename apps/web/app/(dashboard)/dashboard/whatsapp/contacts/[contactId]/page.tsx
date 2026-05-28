import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  appointmentsCache,
  calls,
  treatments,
  users,
  whatsappContactNotes,
  whatsappContacts,
  whatsappConversations,
  whatsappMessages,
} from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';

import { ContactDetailForm } from './_components/contact-detail-form';
import { ContactHistoryTabs } from './_components/contact-history-tabs';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ contactId: string }>;
}

export default async function ContactDetailPage({ params }: Props) {
  const { contactId } = await params;
  const { tenant } = await getCurrentTenant();

  const contactRows = await db
    .select()
    .from(whatsappContacts)
    .where(
      and(eq(whatsappContacts.id, contactId), eq(whatsappContacts.tenantId, tenant.id)),
    )
    .limit(1);
  const contact = contactRows[0];
  if (!contact) notFound();

  // Conversaciones del contacto (una entrada por conversación).
  const conversations = await db
    .select({
      id: whatsappConversations.id,
      channel: whatsappConversations.channel,
      status: whatsappConversations.status,
      lastMsgAt: whatsappConversations.lastMsgAt,
    })
    .from(whatsappConversations)
    .where(eq(whatsappConversations.contactId, contact.id))
    .orderBy(desc(whatsappConversations.lastMsgAt));
  const conversationIds = conversations.map((c) => c.id);

  // Para la pestaña "Historial" queremos UNA entrada por conversación con el
  // último mensaje no interno. Bajamos los últimos N mensajes y agrupamos en
  // memoria — alcanza para los típicos <10 conversaciones por contacto.
  const lastMessagesRaw =
    conversationIds.length > 0
      ? await db
          .select({
            id: whatsappMessages.id,
            conversationId: whatsappMessages.conversationId,
            direction: whatsappMessages.direction,
            senderType: whatsappMessages.senderType,
            contentText: whatsappMessages.contentText,
            type: whatsappMessages.type,
            createdAt: whatsappMessages.createdAt,
          })
          .from(whatsappMessages)
          .where(
            and(
              inArray(whatsappMessages.conversationId, conversationIds),
              eq(whatsappMessages.internalNote, false),
            ),
          )
          .orderBy(desc(whatsappMessages.createdAt))
          .limit(200)
      : [];
  const lastByConv = new Map<string, (typeof lastMessagesRaw)[number]>();
  for (const m of lastMessagesRaw) {
    if (!lastByConv.has(m.conversationId)) lastByConv.set(m.conversationId, m);
  }

  const [callRows, treatmentRows, noteRows] = await Promise.all([
    contact.ghlContactId
      ? db
          .select({
            id: calls.id,
            startedAt: calls.startedAt,
            durationSeconds: calls.durationSeconds,
            status: calls.status,
            intent: calls.intent,
            summary: calls.summary,
          })
          .from(calls)
          .where(
            and(eq(calls.tenantId, tenant.id), eq(calls.ghlContactId, contact.ghlContactId)),
          )
          .orderBy(desc(calls.startedAt))
          .limit(50)
      : Promise.resolve([]),
    db
      .select({ id: treatments.id, label: treatments.name })
      .from(treatments)
      .where(eq(treatments.tenantId, tenant.id)),
    db
      .select({
        id: whatsappContactNotes.id,
        body: whatsappContactNotes.body,
        authorUserId: whatsappContactNotes.authorUserId,
        createdAt: whatsappContactNotes.createdAt,
      })
      .from(whatsappContactNotes)
      .where(
        and(
          eq(whatsappContactNotes.tenantId, tenant.id),
          eq(whatsappContactNotes.contactId, contact.id),
        ),
      )
      .orderBy(desc(whatsappContactNotes.createdAt)),
  ]);

  // Emails de los autores de notas para mostrar quién escribió.
  const noteAuthorIds = Array.from(
    new Set(noteRows.map((n) => n.authorUserId).filter((x): x is string => Boolean(x))),
  );
  const noteAuthorMap = new Map<string, string>();
  if (noteAuthorIds.length > 0) {
    const senders = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.id, noteAuthorIds));
    for (const u of senders) noteAuthorMap.set(u.id, u.email);
  }

  const appointmentRows = contact.ghlContactId
    ? await db
        .select()
        .from(appointmentsCache)
        .where(
          and(
            eq(appointmentsCache.tenantId, tenant.id),
            eq(appointmentsCache.contactId, contact.ghlContactId),
          ),
        )
        .orderBy(asc(appointmentsCache.startTime))
    : [];

  const treatmentMap = new Map(treatmentRows.map((t) => [t.id, t.label]));

  const fullName =
    [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
    contact.name ||
    contact.phoneE164;
  const initials = computeInitials(contact.firstName, contact.lastName, contact.phoneE164);

  return (
    // Outer: ocupa toda la altura visible. NO scrollea.
    <div className="-mx-4 flex h-[calc(100vh-7.5rem)] gap-4 overflow-hidden sm:mx-0">
      {/* COLUMNA IZQUIERDA: contenedor flex-col con header fijo + form scrollable. */}
      <div className="flex min-w-0 flex-1 flex-col bg-zinc-50">
        {/* Header fijo: breadcrumb + acción. No scrollea. */}
        <div className="shrink-0 px-6 pt-4">
          <div className="flex items-center justify-between">
            <nav className="flex items-center gap-1 text-sm text-zinc-500">
              <Link href="/dashboard/whatsapp" className="hover:text-zinc-700">
                Conversaciones
              </Link>
              <span>›</span>
              <span className="font-medium text-zinc-700">{fullName}</span>
            </nav>
            {conversations[0] && (
              <Link
                href={`/dashboard/whatsapp/${conversations[0].id}`}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Enviar mensaje
              </Link>
            )}
          </div>
        </div>

        {/* Hero card fija. No scrollea. */}
        <div className="shrink-0 px-6 pt-4">
          <div className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-5">
            <Avatar avatarUrl={contact.avatarUrl} initials={initials} size={64} />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-zinc-900">{fullName}</h1>
              <p className="text-sm text-zinc-500">{contact.phoneE164}</p>
              <p className="mt-1 text-xs text-zinc-400">
                Creado {formatRelative(contact.createdAt)} · Última actividad{' '}
                {conversations[0]?.lastMsgAt
                  ? formatRelative(conversations[0].lastMsgAt)
                  : '—'}
              </p>
            </div>
          </div>
        </div>

        {/* Formulario scrollable. Solo este bloque scrollea. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
          <ContactDetailForm
            contact={{
              id: contact.id,
              firstName: contact.firstName,
              lastName: contact.lastName,
              email: contact.email,
              phoneE164: contact.phoneE164,
              city: contact.city,
              country: contact.country,
              address: contact.address,
              company: contact.company,
              socialLinks: (contact.socialLinks ?? {}) as Record<string, string>,
            }}
          />
        </div>
      </div>

      {/* COLUMNA DERECHA: independiente, scroll propio. */}
      <div className="hidden w-[420px] shrink-0 overflow-y-auto pr-4 pt-4 lg:block">
        <ContactHistoryTabs
          contactId={contact.id}
          ghlContactId={contact.ghlContactId}
          conversations={conversations.map((c) => {
            const last = lastByConv.get(c.id) ?? null;
            return {
              id: c.id,
              channel: c.channel,
              status: c.status,
              lastMsgAt: c.lastMsgAt ? c.lastMsgAt.toISOString() : null,
              lastMessagePreview: last?.contentText ?? null,
              lastMessageDirection: last?.direction ?? null,
              lastMessageSenderType: last?.senderType ?? null,
            };
          })}
          calls={callRows.map((c) => ({
            ...c,
            startedAt: c.startedAt ? c.startedAt.toISOString() : null,
          }))}
          appointments={appointmentRows.map((a) => ({
            id: a.ghlAppointmentId,
            startTime: a.startTime ? a.startTime.toISOString() : null,
            endTime: a.endTime ? a.endTime.toISOString() : null,
            status: a.status,
            treatment: a.treatmentId ? treatmentMap.get(a.treatmentId) ?? null : null,
          }))}
          notes={noteRows.map((n) => ({
            id: n.id,
            body: n.body,
            authorEmail: n.authorUserId ? noteAuthorMap.get(n.authorUserId) ?? null : null,
            createdAt: n.createdAt.toISOString(),
          }))}
        />
      </div>
    </div>
  );
}

function Avatar({
  avatarUrl,
  initials,
  size,
}: {
  avatarUrl: string | null;
  initials: string;
  size: number;
}) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt="avatar"
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded-full bg-emerald-100 font-semibold text-emerald-700"
      style={{ width: size, height: size, fontSize: size / 3 }}
    >
      {initials}
    </div>
  );
}

function computeInitials(
  firstName: string | null,
  lastName: string | null,
  phone: string,
): string {
  const f = (firstName ?? '').trim();
  const l = (lastName ?? '').trim();
  if (f || l) {
    return ((f[0] ?? '') + (l[0] ?? '')).toUpperCase() || phone.slice(-2);
  }
  return phone.slice(-2);
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  if (days < 365) return `hace ${Math.floor(days / 30)} meses`;
  return `hace ${Math.floor(days / 365)} años`;
}
