import { AnamnesisCard } from '@/components/agenda/anamnesis-card';
import { type BillingLineView, BillingPanel } from '@/components/agenda/billing-panel';
import { ClinicalNoteForm, type PreviousNote } from '@/components/agenda/clinical-note-form';
import { ConsentCard } from '@/components/agenda/consent-card';
import { PatientDialog } from '@/components/agenda/patient-dialog';
import { type PatientFact, PatientHeader } from '@/components/agenda/patient-header';
import { PatientMarks } from '@/components/agenda/patient-marks';
import { PatientReviewAlert } from '@/components/agenda/patient-review-alert';
import {
  type PatientTab,
  type PatientTabItem,
  PatientTabs,
  isPatientTab,
} from '@/components/agenda/patient-tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardTopbar } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { getAgendaContext } from '@/lib/agenda/auth';
import { buildBillingLines, describeConcept, summarizeBilling } from '@/lib/agenda/billing';
import { listPatientCharges } from '@/lib/agenda/charges';
import { getPatientDossier, resolveTimezone } from '@/lib/agenda/queries';
import { STATUS_LABELS } from '@/lib/agenda/shared';
import {
  PRIORITY_LABELS,
  SESSION_BEHAVIOR_FACES,
  SESSION_BEHAVIOR_LABELS,
  ageAt,
  describeAge,
  describeWatchouts,
  guardianNames,
  isSessionBehavior,
  priorityLevel,
} from '@/lib/care-profile/policy';
import { getCareProfile } from '@/lib/care-profile/queries';
import { listPatientConsents, tenantHasEsign } from '@/lib/consents/service';
import { localDateKey } from '@/lib/tasks/tz';
import { Baby, CalendarDays, History, Lock, NotebookPen, Pencil, Star, User } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgendaNav } from '../../agenda-nav';

export const dynamic = 'force-dynamic';

/** 'YYYY-MM-DD' → instante a medianoche UTC, para formatear una fecha de calendario. */
function dateFromKey(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

/**
 * Ficha del paciente: cabecera con lo que se mira antes de atender, pestañas
 * por URL (visita de hoy, anamnesis, historia, citas, contable) y, en la de
 * hoy, un resumen fijo a la derecha.
 *
 * Las pestañas son contenido de servidor y sólo se pinta la activa: `?tab=`
 * decide cuál, y `?nota=<cita>` sigue abriendo la nota de esa cita.
 */
export default async function PacienteDossierPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ nota?: string; tab?: string }>;
}) {
  const { key } = await params;
  const { nota, tab: rawTab } = await searchParams;
  const patientKey = decodeURIComponent(key);

  const ctx = await getAgendaContext();
  const timezone = await resolveTimezone(ctx.tenantId, null);
  const viewerProfessionalId = ctx.scope === 'OWN' ? ctx.professional?.id : undefined;

  const [dossier, careProfile, hasEsign, charges] = await Promise.all([
    getPatientDossier(ctx.tenantId, patientKey, { viewerProfessionalId }),
    getCareProfile(ctx.tenantId),
    // Firma digital: sólo las clínicas que la tienen configurada ven la tarjeta.
    tenantHasEsign(ctx.tenantId).catch(() => false),
    listPatientCharges(ctx.tenantId, patientKey, { viewerProfessionalId }).catch(() => []),
  ]);
  if (!dossier) notFound();

  const fmt = new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const fmtTime = new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const fmtShort = new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
  });
  const fmtDay = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  // El paciente como persona: edad con número, tutores, anamnesis y marcas.
  // Sólo existe en las clínicas con perfil; para el resto `patient` es null y
  // la ficha es la de siempre, con la misma cabecera y las mismas pestañas.
  const person = dossier.patient;
  const pediatric = careProfile?.profile === 'PEDIATRIC';
  const template = person && careProfile ? careProfile.anamnesisTemplate : [];
  const hasAnamnesis = template.length > 0;
  const todayKey = localDateKey(new Date(), timezone);
  const age = person?.birthDate ? describeAge(person.birthDate, todayKey) : null;
  const ageMonths = person?.birthDate
    ? (ageAt(person.birthDate, todayKey)?.totalMonths ?? null)
    : null;
  const priority =
    person && careProfile
      ? priorityLevel({ ageMonths, priorityFlag: person.priorityFlag }, careProfile.bookingPolicy)
      : 'NORMAL';

  // Una nota privada es la valoración personal de quien la escribió: la ve su
  // autor, no el resto del equipo. Vienen de la más nueva a la más vieja.
  const visibleNotes = dossier.notes.filter(
    (n) => !n.private || (ctx.professional && n.professionalId === ctx.professional.id),
  );
  const lastNote = visibleNotes[0] ?? null;
  const lastBehavior =
    lastNote && isSessionBehavior(lastNote.sessionBehavior) ? lastNote.sessionBehavior : null;

  const professionalIdForNote =
    ctx.professional?.id ??
    dossier.appointments.find((a) => a.status === 'COMPLETED')?.professionalId ??
    dossier.appointments[0]?.professionalId ??
    null;
  const canWriteToday = ctx.canWriteClinicalNotes && professionalIdForNote !== null;

  const todaysAppointment =
    dossier.appointments.find(
      (a) => a.status !== 'CANCELLED' && localDateKey(a.startsAt, timezone) === todayKey,
    ) ?? null;
  const seedAppointment = nota ? (dossier.appointments.find((a) => a.id === nota) ?? null) : null;

  // ─── Contable ───────────────────────────────────────────────────────────
  const billingLines = buildBillingLines({
    appointments: dossier.appointments.map((a) => ({
      id: a.id,
      startsAt: a.startsAt,
      status: a.status,
      concept: describeConcept({
        treatmentName: a.treatmentName,
        professionalName: a.professionalName,
        isFirstVisit: pediatric && a.isFirstVisit,
      }),
      treatmentPriceCents: a.treatmentPriceCents,
    })),
    charges: charges.map((c) => ({
      id: c.id,
      appointmentId: c.appointmentId,
      concept: c.concept,
      amountCents: c.amountCents,
      status: c.status,
      paymentMethod: c.paymentMethod,
      paidOn: c.paidOn,
      createdAt: c.createdAt,
      files: c.files.map((f) => ({ id: f.id, name: f.fileName, kind: f.kind })),
    })),
  });
  const billingTotals = summarizeBilling(billingLines);
  const billingViews: BillingLineView[] = billingLines.map((l) => ({
    key: l.key,
    chargeId: l.chargeId,
    appointmentId: l.appointmentId,
    when: fmt.format(l.at),
    concept: l.concept,
    amountCents: l.amountCents,
    status: l.status,
    paymentMethod: l.paymentMethod,
    paidOnLabel: l.paidOn ? fmtDay.format(dateFromKey(l.paidOn)) : null,
    files: l.files,
  }));

  // ─── Pestañas ───────────────────────────────────────────────────────────
  const answered = template.filter(
    (i) => (person?.anamnesis[i.key]?.value ?? null) !== null,
  ).length;
  const pendingAnamnesis = template.length - answered;

  const defaultTab: PatientTab = canWriteToday ? 'visita' : 'historia';
  const tab: PatientTab =
    isPatientTab(rawTab) && (rawTab !== 'anamnesis' || hasAnamnesis) ? rawTab : defaultTab;
  const base = `/dashboard/agenda/pacientes/${encodeURIComponent(patientKey)}`;
  const hrefFor = (t: PatientTab) => (t === defaultTab ? base : `${base}?tab=${t}`);

  const tabItems: PatientTabItem[] = [
    { value: 'visita', label: 'Visita de hoy', shortLabel: 'Hoy' },
    ...(hasAnamnesis
      ? [
          {
            value: 'anamnesis' as const,
            label: 'Anamnesis',
            count: `${answered}/${template.length}`,
            mobileCount: pendingAnamnesis > 0 ? String(pendingAnamnesis) : null,
            warn: pendingAnamnesis > 0,
          },
        ]
      : []),
    {
      value: 'historia',
      label: 'Historia',
      count: visibleNotes.length > 0 ? String(visibleNotes.length) : null,
    },
    {
      value: 'citas',
      label: 'Citas',
      count: dossier.appointments.length > 0 ? String(dossier.appointments.length) : null,
    },
    {
      value: 'contable',
      label: 'Contable',
      count: billingTotals.dueCount > 0 ? String(billingTotals.dueCount) : null,
      mobileCount: billingTotals.dueCount > 0 ? String(billingTotals.dueCount) : null,
      warn: billingTotals.dueCount > 0,
    },
  ];

  // ─── Cabecera ───────────────────────────────────────────────────────────
  const watchouts = person
    ? describeWatchouts(template, person.anamnesis, {
        priorityFlag: person.priorityFlag,
        priorityReason: person.priorityReason,
      })
    : [];
  const pastAppointments = dossier.appointments.filter(
    (a) => a.status === 'COMPLETED' || a.startsAt.getTime() < Date.now(),
  );
  const nextAppointment = [...dossier.appointments]
    .reverse()
    .find((a) => a.status !== 'CANCELLED' && a.startsAt.getTime() >= Date.now());

  const facts: PatientFact[] = person
    ? [
        { label: 'Edad', value: age ?? '—' },
        {
          label: 'Nacimiento',
          value: person.birthDate ? fmtDay.format(dateFromKey(person.birthDate)) : '—',
        },
        { label: 'Tutores', value: guardianNames(person.guardians) || person.contactName || '—' },
        {
          label: 'Última sesión',
          value: lastNote
            ? `${
                lastBehavior
                  ? `${SESSION_BEHAVIOR_FACES[lastBehavior]} ${SESSION_BEHAVIOR_LABELS[lastBehavior]} · `
                  : ''
              }${fmtShort.format(lastNote.createdAt)}`
            : '—',
        },
        {
          label: 'A tener en cuenta',
          value: watchouts.length > 0 ? watchouts.join(' · ') : 'Nada anotado',
          tone: watchouts.length > 0 ? 'warn' : 'muted',
          wide: true,
        },
      ]
    : [
        { label: 'Teléfono', value: dossier.patientPhone ?? '—' },
        { label: 'Email', value: dossier.patientEmail ?? '—' },
        { label: 'Citas', value: String(dossier.appointments.length) },
        {
          label: 'Última visita',
          value: pastAppointments[0] ? fmtShort.format(pastAppointments[0].startsAt) : '—',
        },
        {
          label: 'Próxima cita',
          value: nextAppointment ? fmt.format(nextAppointment.startsAt) : '—',
          wide: true,
        },
      ];

  const previous: PreviousNote | null = lastNote
    ? {
        whenLabel: fmtShort.format(lastNote.createdAt),
        summary: lastNote.summary,
        symptoms: lastNote.symptoms,
        examination: lastNote.examination,
        treatmentPerformed: lastNote.treatmentPerformed,
        observations: lastNote.observations,
        nextSteps: lastNote.nextSteps,
      }
    : null;

  const consents =
    tab === 'visita' && hasEsign && person
      ? await listPatientConsents(ctx.tenantId, person.id).catch(() => [])
      : [];

  const showAside = tab === 'visita';

  return (
    <>
      <AgendaNav active="pacientes" ctx={{ canManageProfessionals: ctx.canManageProfessionals }} />

      <div className="mt-4 flex flex-col gap-3.5 md:mt-5 md:gap-5">
        <PatientHeader
          eyebrow="Agenda · Paciente"
          icon={person ? <Baby className="h-5 w-5" /> : <User className="h-5 w-5" />}
          name={dossier.patientName}
          badges={
            <>
              {priority !== 'NORMAL' && (
                <Badge tone={priority === 'VERY_HIGH' ? 'danger' : 'warn'}>
                  {PRIORITY_LABELS[priority]}
                </Badge>
              )}
              {person?.googleReview && (
                <Badge tone="warn" title="Dejó reseña en Google">
                  <Star className="h-3 w-3 fill-amber-500 text-amber-500" /> Reseña
                </Badge>
              )}
            </>
          }
          action={
            person && ctx.canWriteAppointments ? (
              <PatientDialog
                mode="edit"
                patient={{
                  id: person.id,
                  firstName: person.firstName,
                  lastName: person.lastName,
                  birthDate: person.birthDate,
                  guardians: person.guardians,
                  contactPhone: person.contactPhone,
                  contactName: person.contactName,
                  notes: person.notes,
                }}
                trigger={
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="Editar"
                    className="md:h-11 md:w-auto md:px-4"
                  >
                    <Pencil className="h-4 w-4" />
                    <span className="hidden md:inline">Editar</span>
                  </Button>
                }
              />
            ) : undefined
          }
          facts={facts}
        />

        {person?.needsHumanReview && (
          <PatientReviewAlert
            patientId={person.id}
            reason={person.reviewReason}
            priorityFlag={person.priorityFlag}
            priorityReason={person.priorityReason}
            googleReview={person.googleReview}
            canEdit={ctx.canWriteAppointments}
          />
        )}

        <PatientTabs items={tabItems} active={tab} hrefFor={hrefFor} />

        <div
          className={
            showAside
              ? 'grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]'
              : 'grid items-start gap-5'
          }
        >
          <Card className="min-w-0">
            {tab === 'visita' &&
              (canWriteToday && professionalIdForNote ? (
                <>
                  {hasAnamnesis && pendingAnamnesis > 0 && (
                    <Link
                      href={hrefFor('anamnesis')}
                      prefetch={false}
                      className="mx-4 mt-4 flex min-h-12 items-center justify-between gap-2 rounded-[14px] border border-dashed border-amber-300 bg-amber-50 px-3.5 text-[14px] font-semibold text-amber-700 lg:hidden"
                    >
                      <span>Anamnesis: {pendingAnamnesis} sin contestar</span>
                      <span className="whitespace-nowrap">Completar →</span>
                    </Link>
                  )}
                  <ClinicalNoteForm
                    patientKey={dossier.patientKey}
                    patientName={dossier.patientName}
                    professionalId={professionalIdForNote}
                    template={pediatric ? 'PEDIATRIC' : 'DEFAULT'}
                    title="Nota de hoy"
                    subtitle={
                      todaysAppointment
                        ? `Hoy ${fmtTime.format(todaysAppointment.startsAt)} · ${todaysAppointment.professionalName}${todaysAppointment.treatmentName ? ` · ${todaysAppointment.treatmentName}` : ''}`
                        : `Sin cita hoy${ctx.professional ? ` · ${ctx.professional.fullName}` : ''}`
                    }
                    previous={previous}
                    appointments={dossier.appointments
                      .filter((a) => a.status !== 'CANCELLED')
                      .slice(0, 20)
                      .map((a) => ({
                        id: a.id,
                        label: `${fmt.format(a.startsAt)} · ${a.professionalName}${a.treatmentName ? ` · ${a.treatmentName}` : ''}`,
                        professionalId: a.professionalId,
                      }))}
                    defaultAppointmentId={seedAppointment?.id ?? todaysAppointment?.id ?? null}
                  />
                </>
              ) : (
                <EmptyState
                  icon={<NotebookPen className="h-5 w-5" />}
                  title="La nota de hoy la escribe el profesional"
                  description="Tu rol permite consultar la ficha. La historia y las citas están en sus pestañas."
                />
              ))}

            {tab === 'anamnesis' && person && (
              <AnamnesisCard
                patientId={person.id}
                template={template}
                answers={person.anamnesis}
                canEdit={ctx.canWriteClinicalNotes}
              />
            )}

            {tab === 'historia' && (
              <div className="p-4 md:p-6">
                <h2 className="mb-4 text-[18px] font-bold tracking-tight text-zinc-900">
                  Historia clínica{' '}
                  <span className="text-[13px] font-medium text-zinc-500">
                    · la más reciente arriba
                  </span>
                </h2>
                {visibleNotes.length === 0 ? (
                  <EmptyState
                    icon={<History className="h-5 w-5" />}
                    title="Todavía no hay notas"
                    description="Después de atender al paciente, anota aquí el diagnóstico y lo que toca la próxima vez."
                  />
                ) : (
                  <ol className="flex flex-col">
                    {visibleNotes.map((n, idx) => {
                      const behavior = isSessionBehavior(n.sessionBehavior)
                        ? n.sessionBehavior
                        : null;
                      const last = idx === visibleNotes.length - 1;
                      return (
                        <li key={n.id} className="grid grid-cols-[18px_minmax(0,1fr)] gap-3">
                          <div className="flex flex-col items-center">
                            <span
                              aria-hidden
                              className="mt-1 h-3 w-3 rounded-full bg-brand-500 ring-4 ring-brand-100"
                            />
                            {!last && (
                              <span
                                aria-hidden
                                className="mt-1.5 w-0.5 flex-1 bg-[--color-border]"
                              />
                            )}
                          </div>
                          <div className="flex min-w-0 flex-col gap-1.5 pb-6">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                              <span className="text-[13px] font-bold text-zinc-900">
                                {fmt.format(n.createdAt)}
                              </span>
                              <span className="text-[12px] text-zinc-500">
                                {n.professionalName}
                              </span>
                              {behavior && (
                                <Badge tone="neutral" title="Cómo se portó en la sesión">
                                  <span aria-hidden>{SESSION_BEHAVIOR_FACES[behavior]}</span>{' '}
                                  {SESSION_BEHAVIOR_LABELS[behavior]}
                                </Badge>
                              )}
                              {n.private && (
                                <Badge tone="neutral">
                                  <Lock className="mr-1 h-3 w-3" /> Privada
                                </Badge>
                              )}
                            </div>
                            <p className="text-[15px] font-semibold text-zinc-900">
                              <span className="text-zinc-500">
                                {pediatric ? 'Diagnóstico: ' : 'Motivo: '}
                              </span>
                              {n.summary}
                            </p>
                            {n.symptoms && (
                              <p className="whitespace-pre-line text-[13px] leading-relaxed text-zinc-700">
                                <strong>Síntomas:</strong> {n.symptoms}
                              </p>
                            )}
                            {n.examination && (
                              <p className="whitespace-pre-line text-[13px] leading-relaxed text-zinc-700">
                                <strong>Exploración:</strong> {n.examination}
                              </p>
                            )}
                            {n.treatmentPerformed && (
                              <p className="text-[13px] leading-relaxed text-zinc-700">
                                <strong>{pediatric ? 'Tratamiento' : 'Se hizo'}:</strong>{' '}
                                {n.treatmentPerformed}
                              </p>
                            )}
                            {n.observations && (
                              <p className="whitespace-pre-line text-[13px] leading-relaxed text-zinc-600">
                                {n.observations}
                              </p>
                            )}
                            {n.nextSteps && (
                              <p className="mt-1 rounded-[10px] bg-brand-50 p-2.5 text-[13px] text-brand-800">
                                <strong>Próximo paso:</strong> {n.nextSteps}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            )}

            {tab === 'citas' && (
              <div className="flex flex-col gap-2.5 p-4 md:p-6">
                <h2 className="mb-1.5 text-[18px] font-bold tracking-tight text-zinc-900">
                  Citas{' '}
                  <span className="text-[13px] font-medium text-zinc-500">
                    · {dossier.appointments.length} en total
                  </span>
                </h2>
                {dossier.appointments.length === 0 ? (
                  <EmptyState
                    icon={<CalendarDays className="h-5 w-5" />}
                    title="Todavía sin citas"
                    description="Cuando se le dé hora desde el calendario, aparece aquí."
                  />
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {dossier.appointments.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-start gap-2.5 rounded-[14px] border border-[--color-border] p-3"
                      >
                        <span
                          aria-hidden
                          className="mt-[5px] inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: a.professionalColor }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-semibold text-zinc-800">
                            {fmt.format(a.startsAt)}
                          </p>
                          <p className="mt-0.5 truncate text-[12px] text-zinc-500">
                            {a.professionalName}
                            {a.treatmentName ? ` · ${a.treatmentName}` : ''}
                            {pediatric && a.isFirstVisit ? ' · 1ª visita' : ''}
                          </p>
                        </div>
                        <Badge tone={a.status === 'CANCELLED' ? 'danger' : 'neutral'}>
                          {STATUS_LABELS[a.status]}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {tab === 'contable' && (
              <BillingPanel
                lines={billingViews}
                todayKey={todayKey}
                canWrite={ctx.canWriteAppointments}
              />
            )}
          </Card>

          {showAside && (
            <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[84px]">
              {hasAnamnesis && person && (
                <div className="hidden flex-col gap-2.5 rounded-[22px] border border-[--color-border] bg-white p-[18px] shadow-[var(--shadow-soft)] lg:flex">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                      Anamnesis
                    </span>
                    <span className="text-[12px] font-semibold text-zinc-500">
                      {answered} de {template.length} contestados
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {template
                      .filter((i) => person.anamnesis[i.key]?.value === true)
                      .map((i) => (
                        <span
                          key={i.key}
                          className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-[3px] text-[12px] font-semibold text-brand-700"
                        >
                          {i.label}
                          {person.anamnesis[i.key]?.detail.trim() && (
                            <span className="font-medium text-brand-600">
                              {person.anamnesis[i.key]?.detail.trim()}
                            </span>
                          )}
                        </span>
                      ))}
                    {answered === 0 && (
                      <span className="text-[12px] text-zinc-400">Sin datos todavía</span>
                    )}
                  </div>
                  <Link
                    href={hrefFor('anamnesis')}
                    prefetch={false}
                    className={
                      pendingAnamnesis > 0
                        ? 'flex min-h-11 items-center justify-between gap-2 rounded-[14px] border border-dashed border-amber-300 bg-amber-50 px-3 text-[13px] font-semibold text-amber-700'
                        : 'flex min-h-11 items-center justify-between gap-2 rounded-[14px] border border-[--color-border] bg-[#fbfcfc] px-3 text-[13px] font-semibold text-zinc-600'
                    }
                  >
                    {pendingAnamnesis > 0
                      ? `${pendingAnamnesis} sin contestar`
                      : 'Anamnesis completa'}
                    <span>{pendingAnamnesis > 0 ? 'Completar →' : 'Ver →'}</span>
                  </Link>
                </div>
              )}

              {lastNote && (
                <div className="hidden flex-col gap-2 rounded-[22px] border border-[--color-border] bg-white p-[18px] shadow-[var(--shadow-soft)] lg:flex">
                  <span className="text-[12px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                    Última visita · {fmtShort.format(lastNote.createdAt)}
                  </span>
                  <p className="text-[14px] font-semibold text-zinc-900">{lastNote.summary}</p>
                  <p className="text-[13px] text-zinc-600">
                    {lastBehavior
                      ? `${SESSION_BEHAVIOR_FACES[lastBehavior]} ${SESSION_BEHAVIOR_LABELS[lastBehavior]} · `
                      : ''}
                    {lastNote.professionalName}
                  </p>
                  {lastNote.nextSteps && (
                    <p className="rounded-[10px] bg-brand-50 p-2.5 text-[13px] text-brand-800">
                      <strong>Próximo paso:</strong> {lastNote.nextSteps}
                    </p>
                  )}
                </div>
              )}

              {person && (
                <Card>
                  <CardTopbar
                    icon={<Star className="h-4 w-4" />}
                    title="Marcas"
                    subtitle="Prioridad y reseña: lo leen los asistentes"
                    tone="honey"
                  />
                  <CardContent>
                    <PatientMarks
                      patientId={person.id}
                      priorityFlag={person.priorityFlag}
                      priorityReason={person.priorityReason}
                      googleReview={person.googleReview}
                      computedPriority={priority}
                      lastBehavior={lastBehavior}
                      canEdit={ctx.canWriteAppointments}
                    />
                  </CardContent>
                </Card>
              )}

              {person && hasEsign && (
                <ConsentCard
                  patientId={person.id}
                  patientName={person.fullName}
                  canWrite={ctx.canWriteAppointments}
                  defaults={{
                    name:
                      person.guardians.find((g) => g.role !== 'NINGUNO' && g.name.trim())?.name ??
                      person.contactName ??
                      '',
                    phone: person.contactPhone ?? '',
                    email: person.contactEmail ?? '',
                  }}
                  consents={consents.map((c) => ({
                    id: c.id,
                    status: c.status as 'SENT' | 'SIGNED' | 'CANCELLED' | 'ERROR',
                    recipientName: c.recipientName,
                    recipientPhone: c.recipientPhone,
                    sentAt: c.sentAt?.toISOString() ?? null,
                    signedAt: c.signedAt?.toISOString() ?? null,
                    signingUrl: c.signingUrl,
                    hasPdf: Boolean(c.pdfKey),
                    error: c.error,
                  }))}
                />
              )}
            </aside>
          )}
        </div>
      </div>
    </>
  );
}
