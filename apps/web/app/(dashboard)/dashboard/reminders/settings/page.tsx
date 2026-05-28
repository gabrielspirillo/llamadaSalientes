import { and, asc, eq } from 'drizzle-orm';

import { PageHeader } from '@/components/dashboard/page-header';
import { RulesEditor } from '@/components/reminders/RulesEditor';
import { Card } from '@/components/ui/card';
import { db } from '@/lib/db/client';
import {
  reminderMessageTemplates,
  reminderRuleSets,
  reminderRules,
  treatments,
} from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';

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

  return (
    <>
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
        />
      </Card>
    </>
  );
}
