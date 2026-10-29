import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { AlertTriangle, CalendarClock, Flag, HelpCircle, Users } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { patientKeyForPerson } from '@/lib/agenda/patients';
import { countRedFlagsByPatientKey } from '@/lib/agenda/queries';
import {
  type CareProfile,
  ageAt,
  describeAge,
  describePriority,
  describeWatchouts,
  formatWatchout,
} from '@/lib/care-profile/policy';
import { describeRedFlags, totalRedFlags } from '@/lib/care-profile/signals';
import { db } from '@/lib/db/client';
import { agendaAppointments, patientConsents } from '@/lib/db/schema';
import { type PatientPerson, getPatientPersons } from '@/lib/patients/persons';
import { localDateKey } from '@/lib/tasks/tz';

const MAX_PATIENTS = 4;

/**
 * Lo que recepción tiene que recordar de un paciente mientras le contesta por
 * WhatsApp: edad, prioridad, hermanos, avisos de la anamnesis, faltas, la
 * próxima cita. Sólo con ficha de paciente; sin ella no pinta nada.
 */
export async function PatientBrief({
  tenantId,
  patientIds,
  profile,
  timezone,
  hasEsign,
}: {
  tenantId: string;
  patientIds: string[];
  profile: CareProfile | null;
  timezone: string;
  hasEsign: boolean;
}) {
  const ids = patientIds.slice(0, MAX_PATIENTS);
  if (ids.length === 0) return null;

  const now = new Date();
  const todayKey = localDateKey(now, timezone);
  const [persons, redFlags, appts, consents] = await Promise.all([
    getPatientPersons(tenantId, ids),
    countRedFlagsByPatientKey(tenantId, ids.map(patientKeyForPerson)).catch(() => new Map()),
    db
      .select({
        patientId: agendaAppointments.patientId,
        startsAt: agendaAppointments.startsAt,
      })
      .from(agendaAppointments)
      .where(
        and(
          eq(agendaAppointments.tenantId, tenantId),
          inArray(agendaAppointments.patientId, ids),
          notInArray(agendaAppointments.status, ['CANCELLED', 'NO_SHOW']),
        ),
      ),
    hasEsign
      ? db
          .select({ patientId: patientConsents.patientId, status: patientConsents.status })
          .from(patientConsents)
          .where(
            and(eq(patientConsents.tenantId, tenantId), inArray(patientConsents.patientId, ids)),
          )
      : Promise.resolve([] as { patientId: string | null; status: string }[]),
  ]);

  const people = ids.map((id) => persons.get(id)).filter((p): p is PatientPerson => Boolean(p));
  if (people.length === 0) return null;

  const fmtDay = new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const fmtShort = new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
  });

  return (
    <div className="space-y-3">
      {people.map((p) => {
        const mine = appts.filter((a) => a.patientId === p.id);
        const next = mine
          .filter((a) => a.startsAt > now)
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
        const last = mine
          .filter((a) => a.startsAt <= now)
          .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
        const age = p.birthDate ? describeAge(p.birthDate, todayKey) : null;
        const ageMonths = p.birthDate ? (ageAt(p.birthDate, todayKey)?.totalMonths ?? null) : null;
        const priority = profile
          ? describePriority(
              { ageMonths, priorityFlag: p.priorityFlag, priorityReason: p.priorityReason },
              profile.bookingPolicy,
            )
          : null;
        const watchouts = profile
          ? describeWatchouts(profile.anamnesisTemplate, p.anamnesis).map(formatWatchout)
          : [];
        const flags = redFlags.get(patientKeyForPerson(p.id));
        const flagTotal = flags
          ? totalRedFlags({ ...flags, prior: p.priorRedFlags })
          : p.priorRedFlags;
        // Hermanos: los otros niños del mismo teléfono. Misma fecha = mellizos.
        const siblings = people.filter((o) => o.id !== p.id);
        const twins = siblings.filter((o) => p.birthDate && o.birthDate === p.birthDate);
        const familyLabel =
          p.siblingMark === 'TWIN' || twins.length > 0
            ? `Mellizo/gemelo${twins.length ? ` de ${twins.map((t) => t.firstName).join(', ')}` : ''}`
            : p.siblingMark === 'SIBLING' || siblings.length > 0
              ? `Hermano/a${siblings.length ? ` de ${siblings.map((t) => t.firstName).join(', ')}` : ''}`
              : null;
        const signed = consents.some((c) => c.patientId === p.id && c.status === 'SIGNED');

        return (
          <div
            key={p.id}
            className="rounded-[22px] border border-(--color-border) bg-white p-4 shadow-[var(--shadow-soft)]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link
                  href={`/dashboard/agenda/pacientes/${encodeURIComponent(patientKeyForPerson(p.id))}`}
                  prefetch={false}
                  className="block truncate text-[15px] font-bold text-zinc-900 hover:text-brand-700"
                >
                  {p.fullName}
                </Link>
                {age && <p className="text-[13px] text-zinc-500">{age}</p>}
              </div>
              {priority && priority.level !== 'NORMAL' && (
                <Badge tone={priority.level === 'VERY_HIGH' ? 'danger' : 'warn'} size="sm">
                  {priority.level === 'VERY_HIGH' ? 'Muy prioritario' : 'Prioritario'}
                </Badge>
              )}
            </div>

            <ul className="mt-3 space-y-1.5 text-[13px] text-zinc-700">
              {p.needsHumanReview && (
                <li className="flex gap-2 rounded-xl bg-rose-50 px-2.5 py-1.5 text-rose-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>Aviso médico sin valorar{p.reviewReason ? `: ${p.reviewReason}` : ''}</span>
                </li>
              )}
              {watchouts.length > 0 && (
                <li className="flex gap-2 rounded-xl bg-amber-50 px-2.5 py-1.5 text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{watchouts.join(' · ')}</span>
                </li>
              )}
              {familyLabel && (
                <li className="flex gap-2">
                  <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
                  <span>{familyLabel}</span>
                </li>
              )}
              {p.hesitant && (
                <li className="flex gap-2">
                  <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <span>Familia que duda{p.hesitantNote ? `: ${p.hesitantNote}` : ''}</span>
                </li>
              )}
              {flagTotal > 0 && (
                <li className="flex gap-2">
                  <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" />
                  <span>
                    {flags
                      ? describeRedFlags({ ...flags, prior: p.priorRedFlags })
                      : `${flagTotal} anteriores`}
                  </span>
                </li>
              )}
              <li className="flex gap-2">
                <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
                <span>
                  {next ? `Próxima: ${fmtDay.format(next.startsAt)}` : 'Sin próxima cita'}
                  {last ? ` · Última: ${fmtShort.format(last.startsAt)}` : ''}
                </span>
              </li>
              {hasEsign && !signed && (
                <li className="text-[12px] font-medium text-amber-700">
                  Consentimiento sin firmar
                </li>
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
