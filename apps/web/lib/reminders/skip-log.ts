import 'server-only';
import { db } from '@/lib/db/client';
import { reminderSkipLog } from '@/lib/db/schema';

export type ReminderSkipReason =
  | 'no_phone'
  | 'past_due'
  | 'no_rules'
  | 'no_whatsapp'
  | 'no_voice_agent'
  | 'no_template'
  | 'quiet_hours_full_day'
  | 'opt_out'
  | 'appointment_cancelled'
  | 'duplicate';

export async function logReminderSkip(args: {
  tenantId: string;
  ghlAppointmentId: string;
  ruleId?: string | null;
  reason: ReminderSkipReason;
  details?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(reminderSkipLog).values({
    tenantId: args.tenantId,
    ghlAppointmentId: args.ghlAppointmentId,
    ruleId: args.ruleId ?? null,
    reason: args.reason,
    details: args.details ?? {},
  });
}
