import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';

import { getAgendaContext } from '@/lib/agenda/auth';
import { closedWeekdays } from '@/lib/agenda/clinic-hours';
import { MAX_SPECIAL_DAYS_AHEAD } from '@/lib/agenda/special-days';
import { listSpecialDays } from '@/lib/agenda/special-days-db';
import { db } from '@/lib/db/client';
import { clinicSettings, professionalShifts, professionals } from '@/lib/db/schema';
import { addDaysToKey, localDateKey } from '@/lib/tasks/tz';
import type { SpecialDayItem, SpecialDaysProfessional } from './special-days-card';

/** Lo que pinta la tarjeta "Días con horario especial" de Datos de la clínica. */
export async function loadSpecialDaysCardData(tenantId: string): Promise<{
  canEdit: boolean;
  professionals: SpecialDaysProfessional[];
  days: SpecialDayItem[];
  todayKey: string;
  clinicClosedWeekdays: number[];
}> {
  const [ctx, settingsRow, profRows] = await Promise.all([
    getAgendaContext().catch(() => null),
    db
      .select({ timezone: clinicSettings.timezone, workingHours: clinicSettings.workingHours })
      .from(clinicSettings)
      .where(eq(clinicSettings.tenantId, tenantId))
      .limit(1),
    db
      .select({ id: professionals.id, fullName: professionals.fullName })
      .from(professionals)
      .where(
        and(
          eq(professionals.tenantId, tenantId),
          eq(professionals.active, true),
          eq(professionals.agendaEnabled, true),
        ),
      )
      .orderBy(professionals.fullName),
  ]);
  const tz = settingsRow[0]?.timezone || 'Europe/Madrid';
  const todayKey = localDateKey(new Date(), tz);
  const ids = profRows.map((p) => p.id);
  const [shifts, days] = await Promise.all([
    ids.length
      ? db
          .select({
            professionalId: professionalShifts.professionalId,
            weekday: professionalShifts.weekday,
            startMinute: professionalShifts.startMinute,
            endMinute: professionalShifts.endMinute,
          })
          .from(professionalShifts)
          .where(
            and(
              eq(professionalShifts.tenantId, tenantId),
              eq(professionalShifts.active, true),
              inArray(professionalShifts.professionalId, ids),
            ),
          )
      : Promise.resolve([]),
    ids.length
      ? listSpecialDays(tenantId, {
          professionalIds: ids,
          fromKey: todayKey,
          toKey: addDaysToKey(todayKey, MAX_SPECIAL_DAYS_AHEAD),
        })
      : Promise.resolve([]),
  ]);
  return {
    canEdit: Boolean(ctx?.canManageProfessionals),
    professionals: profRows.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      shifts: shifts.filter((s) => s.professionalId === p.id),
    })),
    days,
    todayKey,
    clinicClosedWeekdays: closedWeekdays(
      settingsRow[0]?.workingHours as Parameters<typeof closedWeekdays>[0],
    ),
  };
}
