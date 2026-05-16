import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { whatsappContacts, whatsappConversations, whatsappMessages } from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';

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

function statusBadge(status: 'ACTIVE' | 'HANDOFF' | 'CLOSED'): { label: string; cls: string } {
  switch (status) {
    case 'ACTIVE':
      return { label: 'Activa', cls: 'bg-emerald-100 text-emerald-800' };
    case 'HANDOFF':
      return { label: 'En manos del operador', cls: 'bg-amber-100 text-amber-800' };
    case 'CLOSED':
      return { label: 'Cerrada', cls: 'bg-zinc-100 text-zinc-600' };
  }
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
      contactName: whatsappContacts.name,
      contactPhone: whatsappContacts.phoneE164,
    })
    .from(whatsappConversations)
    .innerJoin(whatsappContacts, eq(whatsappContacts.id, whatsappConversations.contactId))
    .where(eq(whatsappConversations.tenantId, tenant.id))
    .orderBy(desc(whatsappConversations.lastMsgAt))
    .limit(100);

  // Para preview: traer último mensaje de cada conversación. Versión simple,
  // una query por conversación (OK hasta ~100). Si crece se mueve a subquery.
  const previews = await Promise.all(
    rows.map(async (r) => {
      const last = await db
        .select({
          contentText: whatsappMessages.contentText,
          direction: whatsappMessages.direction,
          createdAt: whatsappMessages.createdAt,
        })
        .from(whatsappMessages)
        .where(eq(whatsappMessages.conversationId, r.id))
        .orderBy(desc(whatsappMessages.createdAt))
        .limit(1);
      return { id: r.id, last: last[0] ?? null };
    }),
  );
  const previewMap = new Map(previews.map((p) => [p.id, p.last]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">WhatsApp</h1>
          <p className="text-sm text-zinc-500">
            Conversaciones entrantes de Meta Cloud API y Evolution.
          </p>
        </div>
        <Link
          href="/dashboard/whatsapp/integrations"
          className="inline-flex items-center rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Integraciones
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 p-10 text-center">
          <p className="text-sm text-zinc-600">
            Aún no hay conversaciones. Configura una integración de WhatsApp para
            empezar a recibir mensajes.
          </p>
          <Link
            href="/dashboard/whatsapp/integrations"
            className="mt-4 inline-flex items-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Configurar WhatsApp
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <table className="w-full">
            <thead className="border-b border-zinc-200 bg-zinc-50/60 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">Contacto</th>
                <th className="px-4 py-3">Último mensaje</th>
                <th className="px-4 py-3">Canal</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Cuándo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 text-sm text-zinc-700">
              {rows.map((r) => {
                const badge = statusBadge(r.status);
                const preview = previewMap.get(r.id);
                return (
                  <tr key={r.id} className="hover:bg-zinc-50/50">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/whatsapp/${r.id}`} className="block">
                        <div className="font-medium text-zinc-900">
                          {r.contactName ?? r.contactPhone}
                          {r.urgentFlag && (
                            <span className="ml-2 inline-flex items-center rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                              URGENTE
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500">{r.contactPhone}</div>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/whatsapp/${r.id}`} className="block">
                        <span className="line-clamp-1 max-w-[40ch] text-zinc-600">
                          {preview?.direction === 'OUTBOUND' && (
                            <span className="text-zinc-400">Tú: </span>
                          )}
                          {preview?.contentText ?? '—'}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {r.channel === 'WHATSAPP_CLOUD' ? 'Cloud API' : 'Evolution'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {relativeTime(r.lastMsgAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
