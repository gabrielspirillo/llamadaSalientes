import { and, desc, eq, inArray, notInArray } from 'drizzle-orm';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ClipboardCheck,
  Flag,
  Pill,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import type { ComponentType } from 'react';

import { patientKeyForPerson } from '@/lib/agenda/patients';
import { countRedFlagsByPatientKey } from '@/lib/agenda/queries';
import {
  type CareProfile,
  GUARDIAN_ROLE_LABELS,
  PRIORITY_LABELS,
  activeGuardians,
  ageAt,
  describeAge,
  describeMedication,
  describePriority,
  describeWatchouts,
  formatWatchout,
} from '@/lib/care-profile/policy';
import { describeRedFlags, totalRedFlags } from '@/lib/care-profile/signals';
import { cn } from '@/lib/cn';
import { db } from '@/lib/db/client';
import {
  agendaAppointments,
  clinicalNotes,
  patientCharges,
  patientConsents,
} from '@/lib/db/schema';
import { type CasePoint, type CasePointKind, buildCaseSummary } from '@/lib/patients/case-summary';
import { formatPhoneDisplay } from '@/lib/patients/names';
import { type PatientPerson, getPatientPersons } from '@/lib/patients/persons';
import { richToPlain } from '@/lib/rich-text';
import { localDateKey } from '@/lib/tasks/tz';

const MAX_PATIENTS = 4;

const ICONS: Record<CasePointKind, ComponentType<{ className?: string }>> = {
  review: ShieldAlert,
  medication: Pill,
  watchouts: AlertTriangle,
  last: Stethoscope,
  'next-step': ArrowRight,
  next: CalendarClock,
  family: Users,
  guardians: Users,
  signals: Flag,
  pending: ClipboardCheck,
};

const TONES: Record<CasePoint['tone'], string> = {
  alert: 'bg-rose-400/15 text-rose-200 ring-rose-300/30',
  warn: 'bg-amber-300/15 text-amber-100 ring-amber-200/30',
  info: 'bg-white/10 text-sky-100 ring-white/15',
  good: 'bg-emerald-300/15 text-emerald-100 ring-emerald-200/30',
};

/**
 * "Resumen del caso" de cada niño, en la ficha y en el chat: un bloque oscuro
 * que contrasta con el resto de la página y dice en un titular y unos puntos lo
 * que hay que recordar antes de contestar o atender. Sólo pacientes con ficha
 * (clínicas con perfil de atención). Las notas privadas no entran.
 */
export async function CaseSummaryCards({
  tenantId,
  patientIds,
  profile,
  timezone,
  hasEsign,
  showFichaLink = true,
  omit = [],
  wide = false,
}: {
  tenantId: string;
  patientIds: string[];
  profile: CareProfile | null;
  timezone: string;
  hasEsign: boolean;
  showFichaLink?: boolean;
  /** Puntos que ya se ven en la página (en la ficha, medicación y alertas van justo encima). */
  omit?: CasePointKind[];
  /** A todo el ancho (ficha): los puntos en dos columnas. */
  wide?: boolean;
}) {
  const ids = patientIds.slice(0, MAX_PATIENTS);
  if (ids.length === 0) return null;
  const keys = ids.map(patientKeyForPerson);

  const now = new Date();
  const todayKey = localDateKey(now, timezone);
  const [persons, redFlags, appts, notes, consents, charges] = await Promise.all([
    getPatientPersons(tenantId, ids),
    countRedFlagsByPatientKey(tenantId, keys).catch(() => new Map()),
    db
      .select({
        patientId: agendaAppointments.patientId,
        startsAt: agendaAppointments.startsAt,
        status: agendaAppointments.status,
      })
      .from(agendaAppointments)
      .where(
        and(
          eq(agendaAppointments.tenantId, tenantId),
          inArray(agendaAppointments.patientId, ids),
          notInArray(agendaAppointments.status, ['CANCELLED', 'NO_SHOW']),
        ),
      ),
    db
      .select({
        patientKey: clinicalNotes.patientKey,
        createdAt: clinicalNotes.createdAt,
        summary: clinicalNotes.summary,
        nextSteps: clinicalNotes.nextSteps,
      })
      .from(clinicalNotes)
      .where(
        and(
          eq(clinicalNotes.tenantId, tenantId),
          inArray(clinicalNotes.patientKey, keys),
          eq(clinicalNotes.private, false),
        ),
      )
      .orderBy(desc(clinicalNotes.createdAt))
      .limit(40),
    hasEsign
      ? db
          .select({ patientId: patientConsents.patientId, status: patientConsents.status })
          .from(patientConsents)
          .where(
            and(eq(patientConsents.tenantId, tenantId), inArray(patientConsents.patientId, ids)),
          )
      : Promise.resolve([] as { patientId: string | null; status: string }[]),
    db
      .select({ patientKey: patientCharges.patientKey })
      .from(patientCharges)
      .where(
        and(
          eq(patientCharges.tenantId, tenantId),
          inArray(patientCharges.patientKey, keys),
          eq(patientCharges.status, 'PENDING'),
        ),
      ),
  ]);

  const people = ids.map((id) => persons.get(id)).filter((p): p is PatientPerson => Boolean(p));
  if (people.length === 0) return null;

  const fmtWhen = new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const fmtDay = new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
  });
  const template = profile?.anamnesisTemplate ?? [];

  return (
    <div className="space-y-3">
      {people.map((p) => {
        const key = patientKeyForPerson(p.id);
        const mine = appts.filter((a) => a.patientId === p.id);
        const next = mine
          .filter((a) => a.startsAt > now)
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
        const done = mine.filter((a) => a.startsAt <= now).length;
        const lastNote = notes.find((n) => n.patientKey === key) ?? null;
        const ageMonths = p.birthDate ? (ageAt(p.birthDate, todayKey)?.totalMonths ?? null) : null;
        const priority = profile
          ? describePriority(
              { ageMonths, priorityFlag: p.priorityFlag, priorityReason: p.priorityReason },
              profile.bookingPolicy,
            )
          : null;
        const flags = redFlags.get(key);
        const flagTotal = flags
          ? totalRedFlags({ ...flags, prior: p.priorRedFlags })
          : p.priorRedFlags;
        const siblings = people.filter((o) => o.id !== p.id);
        const twins = siblings.filter((o) => p.birthDate && o.birthDate === p.birthDate);
        const family =
          p.siblingMark === 'TWIN' || twins.length > 0
            ? `Mellizo/gemelo${twins.length ? ` de ${twins.map((t) => t.firstName).join(', ')}` : ''}`
            : siblings.length > 0
              ? `Hermano/a de ${siblings.map((t) => t.firstName).join(', ')}`
              : null;
        const answered = template.filter(
          (i) => (p.anamnesis[i.key]?.value ?? null) !== null,
        ).length;
        const summary = buildCaseSummary({
          firstName: p.firstName,
          age: p.birthDate ? describeAge(p.birthDate, todayKey) : null,
          priority:
            priority && priority.level !== 'NORMAL'
              ? `${PRIORITY_LABELS[priority.level]}${priority.source === 'AGE' ? ' por edad' : ''}`
              : null,
          medication: describeMedication(template, p.anamnesis),
          watchouts: describeWatchouts(template, p.anamnesis).map(formatWatchout),
          needsReview: p.needsHumanReview,
          reviewReason: p.reviewReason,
          family,
          guardians: activeGuardians(p.guardians).map((g) => {
            const tel = g.phone?.trim() || (g.primary ? p.contactPhone : null);
            return [
              `${GUARDIAN_ROLE_LABELS[g.role]} ${g.name}`.trim(),
              tel ? formatPhoneDisplay(tel) : null,
            ]
              .filter(Boolean)
              .join(' · ');
          }),
          sessionsDone: done,
          lastSession: lastNote
            ? {
                when: fmtDay.format(lastNote.createdAt),
                diagnosis: richToPlain(lastNote.summary),
                nextSteps: richToPlain(lastNote.nextSteps),
              }
            : null,
          nextAppointment: next ? fmtWhen.format(next.startsAt) : null,
          redFlags:
            flagTotal > 0 && flags ? describeRedFlags({ ...flags, prior: p.priorRedFlags }) : null,
          hesitant: p.hesitant
            ? `Familia que duda${p.hesitantNote ? `: ${p.hesitantNote}` : ''}`
            : null,
          consentPending:
            hasEsign && !consents.some((c) => c.patientId === p.id && c.status === 'SIGNED'),
          pendingCharges: charges.filter((c) => c.patientKey === key).length,
          anamnesisPending: template.length - answered,
        });

        return (
          <section
            key={p.id}
            aria-label={`Resumen del caso de ${p.fullName}`}
            className="relative overflow-hidden rounded-[22px] border border-white/10 bg-[linear-gradient(140deg,#14211d_0%,#1d3a33_55%,#2b5a4d_100%)] p-4 text-white shadow-[var(--shadow-float)] animate-fade-up sm:p-5"
          >
            {/* Brillo de fondo: da profundidad sin distraer de los puntos. */}
            <div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-emerald-300/20 blur-3xl animate-drift"
            />
            <div className="relative flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-200/90">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden /> Resumen del caso
                </p>
                <p className="mt-1.5 text-[15px] font-semibold leading-snug text-white">
                  {summary.headline}
                </p>
              </div>
              {showFichaLink && (
                <Link
                  href={`/dashboard/agenda/pacientes/${encodeURIComponent(key)}`}
                  prefetch={false}
                  className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-[12px] font-semibold text-white ring-1 ring-white/20 transition-colors hover:bg-white/20"
                >
                  Ficha
                </Link>
              )}
            </div>
            <ul className={cn('stagger relative mt-3 grid gap-1.5', wide && 'md:grid-cols-2')}>
              {summary.points
                .filter((pt) => !omit.includes(pt.kind))
                .map((pt, i) => {
                  const Icon = ICONS[pt.kind];
                  return (
                    <li
                      key={pt.kind}
                      style={{ ['--i' as string]: i }}
                      className={cn(
                        'flex items-start gap-2.5 rounded-2xl px-3 py-2 text-[13px] ring-1 animate-fade-up',
                        TONES[pt.tone],
                      )}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span className="min-w-0">
                        <span className="font-bold text-white">{pt.label}: </span>
                        <span className="break-words">{pt.text}</span>
                      </span>
                    </li>
                  );
                })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
