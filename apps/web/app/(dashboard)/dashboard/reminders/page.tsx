import { and, desc, eq } from 'drizzle-orm';
import Link from 'next/link';

import { PageHeader } from '@/components/dashboard/page-header';
import { RemindersPipeline } from '@/components/reminders/Pipeline';
import { SkipList } from '@/components/reminders/SkipList';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/db/client';
import {
  appointmentReminders,
  reminderRules,
  reminderSkipLog,
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
    .select()
    .from(reminderSkipLog)
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

      <RemindersPipeline reminders={reminders} rulesById={rulesById} />

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">Omitidos ({skipped.length})</h2>
        <SkipList skipped={skipped} />
      </div>
    </>
  );
}
