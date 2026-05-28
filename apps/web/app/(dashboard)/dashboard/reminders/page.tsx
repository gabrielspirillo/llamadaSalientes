import { and, desc, eq } from 'drizzle-orm';
import Link from 'next/link';

import { PageHeader } from '@/components/dashboard/page-header';
import { RemindersPipeline } from '@/components/reminders/Pipeline';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/db/client';
import {
  appointmentReminders,
  appointmentsCache,
  reminderRules,
  reminderSkipLog,
  treatments,
} from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';
import { Settings2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function RemindersPage() {
  const { tenant } = await getCurrentTenant();

  const reminders = await db
    .select({
      id: appointmentReminders.id,
      ghlAppointmentId: appointmentReminders.ghlAppointmentId,
      ruleId: appointmentReminders.ruleId,
      scheduledFor: appointmentReminders.scheduledFor,
      channelPlanned: appointmentReminders.channelPlanned,
      channelUsed: appointmentReminders.channelUsed,
      status: appointmentReminders.status,
      sentAt: appointmentReminders.sentAt,
      respondedAt: appointmentReminders.respondedAt,
      failureReason: appointmentReminders.failureReason,
      payloadSnapshot: appointmentReminders.payloadSnapshot,
    })
    .from(appointmentReminders)
    .where(eq(appointmentReminders.tenantId, tenant.id))
    .orderBy(desc(appointmentReminders.scheduledFor))
    .limit(500);

  const ruleIds = Array.from(new Set(reminders.map((r) => r.ruleId)));
  const rulesByIdEntries: Array<[string, { label: string | null; offsetMinutes: number }]> = [];
  if (ruleIds.length > 0) {
    const rows = await db
      .select({
        id: reminderRules.id,
        label: reminderRules.label,
        offsetMinutes: reminderRules.offsetMinutes,
      })
      .from(reminderRules)
      .where(and(eq(reminderRules.tenantId, tenant.id)));
    for (const r of rows) {
      rulesByIdEntries.push([r.id, { label: r.label, offsetMinutes: r.offsetMinutes }]);
    }
  }
  const rulesById = Object.fromEntries(rulesByIdEntries);

  const skipped = await db
    .select({
      id: reminderSkipLog.id,
      ghlAppointmentId: reminderSkipLog.ghlAppointmentId,
      ruleId: reminderSkipLog.ruleId,
      reason: reminderSkipLog.reason,
      details: reminderSkipLog.details,
      createdAt: reminderSkipLog.createdAt,
      appointmentStart: appointmentsCache.startTime,
      treatmentName: treatments.name,
    })
    .from(reminderSkipLog)
    .leftJoin(
      appointmentsCache,
      and(
        eq(appointmentsCache.tenantId, reminderSkipLog.tenantId),
        eq(appointmentsCache.ghlAppointmentId, reminderSkipLog.ghlAppointmentId),
      ),
    )
    .leftJoin(treatments, eq(treatments.id, appointmentsCache.treatmentId))
    .where(eq(reminderSkipLog.tenantId, tenant.id))
    .orderBy(desc(reminderSkipLog.createdAt))
    .limit(100);

  return (
    <>
      <PageHeader
        title="Recordatorios"
        description="Pipeline de recordatorios de citas multi-canal (WhatsApp + voz)."
        actions={
          <Link href="/dashboard/reminders/settings">
            <Button size="sm" variant="secondary">
              <Settings2 className="h-4 w-4" /> Configurar reglas
            </Button>
          </Link>
        }
      />

      <RemindersPipeline
        initialReminders={reminders}
        initialRulesById={rulesById}
        initialSkipped={skipped}
      />
    </>
  );
}
