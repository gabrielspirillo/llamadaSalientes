import { and, desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { normalizePatientPhone } from '@/lib/agenda/patients';
import { resolveTenantRole, roleSatisfies } from '@/lib/auth/tenant-role';
import { db } from '@/lib/db/client';
import { whatsappConnections, whatsappConversations } from '@/lib/db/schema';
import { findPatientByPhone } from '@/lib/patients/registry';
import { getCurrentTenant } from '@/lib/tenant';
import { getOrCreateOpenConversation, upsertWhatsappContact } from '@/lib/whatsapp/persist';

export const dynamic = 'force-dynamic';

const CHANNEL_FOR_MODE = {
  EVOLUTION: 'WHATSAPP_EVOLUTION',
  CLOUD: 'WHATSAPP_CLOUD',
  TWILIO: 'WHATSAPP_TWILIO',
} as const;

/**
 * El botón "WhatsApp" de la ficha abre el chat de la propia app, no wa.me:
 * la conversación queda en el inbox, con el agente, las notas y el historial.
 * Si el paciente nunca escribió, se crea el hilo para poder escribirle.
 */
export default async function OpenWhatsappChatPage({
  searchParams,
}: {
  searchParams: Promise<{ tel?: string }>;
}) {
  const { tenant } = await getCurrentTenant();
  const phone = normalizePatientPhone((await searchParams).tel);
  if (!phone) redirect('/dashboard/whatsapp');

  const contact = await findPatientByPhone(tenant.id, phone);
  if (contact) {
    const [last] = await db
      .select({ id: whatsappConversations.id })
      .from(whatsappConversations)
      .where(
        and(
          eq(whatsappConversations.tenantId, tenant.id),
          eq(whatsappConversations.contactId, contact.id),
        ),
      )
      .orderBy(desc(whatsappConversations.createdAt))
      .limit(1);
    if (last) redirect(`/dashboard/whatsapp/${last.id}`);
  }

  // Abrir un hilo nuevo es escribir: quien sólo mira va a la bandeja.
  const ctx = await resolveTenantRole();
  const [connection] = await db
    .select({ mode: whatsappConnections.mode })
    .from(whatsappConnections)
    .where(
      and(eq(whatsappConnections.tenantId, tenant.id), eq(whatsappConnections.status, 'CONNECTED')),
    )
    .limit(1);
  if (!connection || !ctx.role || !roleSatisfies(ctx.role, 'operator')) {
    redirect(`/dashboard/whatsapp?q=${encodeURIComponent(phone)}`);
  }

  const row =
    contact ?? (await upsertWhatsappContact({ tenantId: tenant.id, phoneE164: phone, name: null }));
  const conversation = await getOrCreateOpenConversation({
    tenantId: tenant.id,
    contactId: row.id,
    channel: CHANNEL_FOR_MODE[connection.mode],
  });
  redirect(`/dashboard/whatsapp/${conversation.id}`);
}
