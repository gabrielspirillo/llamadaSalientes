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
import { BellRing } from 'lucide-react';
import { ChevronLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function RemindersSettingsPage() {
  const { tenant } = await getCurrentTenant();

  // Las cinco sólo dependen del tenant, que ya está resuelto: encadenadas eran
  // cinco round-trips a Postgres, uno detrás de otro, antes de pintar nada.
  const [ruleSets, rules, templates, treatmentRows, waConnRows] = await Promise.all([
    db.select().from(reminderRuleSets).where(eq(reminderRuleSets.tenantId, tenant.id)),

    db
      .select()
      .from(reminderRules)
      .where(eq(reminderRules.tenantId, tenant.id))
      .orderBy(asc(reminderRules.order)),

    db
      .select()
      .from(reminderMessageTemplates)
      .where(eq(reminderMessageTemplates.tenantId, tenant.id)),

    db
      .select({ id: treatments.id, name: treatments.name })
      .from(treatments)
      .where(and(eq(treatments.tenantId, tenant.id), eq(treatments.active, true))),

    // Driver activo del tenant (la conexión CONNECTED más reciente). El
    // RulesEditor lo usa para filtrar plantillas WhatsApp y mostrar sólo el
    // driver que corresponde, en lugar de listar los 3.
    db
      .select({ mode: whatsappConnections.mode })
      .from(whatsappConnections)
      .where(
        and(
          eq(whatsappConnections.tenantId, tenant.id),
          eq(whatsappConnections.status, 'CONNECTED'),
        ),
      )
      .orderBy(desc(whatsappConnections.updatedAt))
      .limit(1),
  ]);

  const activeWhatsAppMode = waConnRows[0]?.mode ?? null;

  return (
    <>
      <Link
        href="/dashboard/reminders"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Volver a recordatorios
      </Link>

      <PageHeader
        eyebrow="Automatizaciones"
        icon={<BellRing className="h-5 w-5" />}
        title="Configuración de recordatorios"
        description="Define cuándo y por qué canal se envía cada recordatorio, con una plantilla para cada canal."
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
