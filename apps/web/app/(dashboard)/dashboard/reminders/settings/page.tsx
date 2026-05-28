import { and, asc, desc, eq } from 'drizzle-orm';
import Link from 'next/link';

import { PageHeader } from '@/components/dashboard/page-header';
import { RulesEditor } from '@/components/reminders/RulesEditor';
import { Card } from '@/components/ui/card';
import { db } from '@/lib/db/client';
import {
  reminderMessageTemplates,
  reminderRuleSets,
  reminderRules,
  treatments,
  whatsappConnections,
} from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';
import { ChevronLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function RemindersSettingsPage() {
  const { tenant } = await getCurrentTenant();

  const ruleSets = await db
    .select()
    .from(reminderRuleSets)
    .where(eq(reminderRuleSets.tenantId, tenant.id));

  const rules = await db
    .select()
    .from(reminderRules)
    .where(eq(reminderRules.tenantId, tenant.id))
    .orderBy(asc(reminderRules.order));

  const templates = await db
    .select()
    .from(reminderMessageTemplates)
    .where(eq(reminderMessageTemplates.tenantId, tenant.id));

  const treatmentRows = await db
    .select({ id: treatments.id, name: treatments.name })
    .from(treatments)
    .where(and(eq(treatments.tenantId, tenant.id), eq(treatments.active, true)));

  // Detectar el driver activo del tenant (la conexión CONNECTED más reciente).
  // El RulesEditor lo usa para filtrar plantillas WhatsApp y mostrar solo el
  // driver que corresponde, en lugar de listar los 3.
  const [waConn] = await db
    .select({ mode: whatsappConnections.mode })
    .from(whatsappConnections)
    .where(
      and(eq(whatsappConnections.tenantId, tenant.id), eq(whatsappConnections.status, 'CONNECTED')),
    )
    .orderBy(desc(whatsappConnections.updatedAt))
    .limit(1);
  const activeWhatsAppMode = waConn?.mode ?? null;

  return (
    <>
      <Link
        href="/dashboard/reminders"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Volver al pipeline
      </Link>

      <PageHeader
        title="Configuración de recordatorios"
        description="Define cuándo y por qué canal mandar cada recordatorio, con plantillas multi-canal."
      />

      <Card className="p-6">
        <RulesEditor
          initialRuleSets={ruleSets}
          initialRules={rules}
          initialTemplates={templates}
          treatments={treatmentRows}
          activeWhatsAppMode={activeWhatsAppMode}
        />
      </Card>
    </>
  );
}
