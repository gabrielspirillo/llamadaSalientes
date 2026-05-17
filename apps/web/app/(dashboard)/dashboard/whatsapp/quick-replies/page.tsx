import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { whatsappQuickReplies } from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';

import { QuickRepliesAdmin } from './admin';

export const dynamic = 'force-dynamic';

export default async function QuickRepliesPage() {
  const { tenant } = await getCurrentTenant();
  const rows = await db
    .select({
      id: whatsappQuickReplies.id,
      shortcut: whatsappQuickReplies.shortcut,
      text: whatsappQuickReplies.text,
      updatedAt: whatsappQuickReplies.updatedAt,
    })
    .from(whatsappQuickReplies)
    .where(eq(whatsappQuickReplies.tenantId, tenant.id))
    .orderBy(desc(whatsappQuickReplies.updatedAt));

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/whatsapp" className="text-sm text-zinc-500 hover:text-zinc-700">
          ← Conversaciones
        </Link>
      </div>
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Respuestas rápidas</h1>
        <p className="text-sm text-zinc-500">
          Crea atajos que puedes invocar con &quot;/&quot; en el composer de mensajes.
        </p>
      </div>

      <QuickRepliesAdmin initial={rows} />
    </div>
  );
}
