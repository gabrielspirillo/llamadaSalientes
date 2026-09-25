import { AnamnesisCard } from '@/components/agenda/anamnesis-card';
import { type BillingLineView, BillingPanel } from '@/components/agenda/billing-panel';
import { ClinicalNoteForm, type PreviousNote } from '@/components/agenda/clinical-note-form';
import { ConsentCard } from '@/components/agenda/consent-card';
import { type HistoryNoteView, HistoryTimeline } from '@/components/agenda/history-timeline';
import type { InvoiceCandidateView } from '@/components/agenda/invoice-dialog';
import { type InvoiceListItem, InvoicesCard } from '@/components/agenda/invoices-card';
import { PatientAlertsBanner } from '@/components/agenda/patient-alerts-banner';
import { PatientDialog } from '@/components/agenda/patient-dialog';
import { type PatientFact, PatientHeader } from '@/components/agenda/patient-header';
import { PatientMarks } from '@/components/agenda/patient-marks';
import { PatientReviewAlert } from '@/components/agenda/patient-review-alert';
import { PatientTabs } from '@/components/agenda/patient-tabs';
import { TodayAppointmentCard, type TodayItem } from '@/components/agenda/today-appointment-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardTopbar } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { getAgendaContext } from '@/lib/agenda/auth';
import {
  buildBillingLines,
  describeConcept,
  isPaymentMethod,
  summarizeBilling,
} from '@/lib/agenda/billing';
import { listPatientCharges } from '@/lib/agenda/charges';
import { type PatientTab, type PatientTabItem, isPatientTab } from '@/lib/agenda/patient-tabs';
import { getPatientDossier, listProfessionals, resolveTimezone } from '@/lib/agenda/queries';
import { STATUS_LABELS } from '@/lib/agenda/shared';
import {
  EMPTY_BOOKING_POLICY,
  GUARDIAN_ROLE_LABELS,
  PRIORITY_LABELS,
  SESSION_BEHAVIOR_FACES,
  SESSION_BEHAVIOR_LABELS,
  activeGuardians,
  ageAt,
  describeAge,
  describePriority,
  describeWatchouts,
  formatWatchout,
  isSessionBehavior,
  primaryGuardian,
} from '@/lib/care-profile/policy';
import { getCareProfile } from '@/lib/care-profile/queries';
import { listPatientConsents, tenantHasEsign } from '@/lib/consents/service';
import { getInvoiceContext, listPatientInvoices } from '@/lib/invoices/service';
import { describeActivity, listPatientActivity } from '@/lib/patients/activity';
import { formatPhoneDisplay, initialsOf, phoneDigits } from '@/lib/patients/names';
import { localDateKey } from '@/lib/tasks/tz';
import {
  Activity,
  CalendarDays,
  CalendarPlus,
  MessageCircle,
  Pencil,
  Phone,
  Star,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgendaNav } from '../../agenda-nav';

export const dynamic = 'force-dynamic';

/** 'YYYY-MM-DD' → instante a medianoche UTC, para formatear una fecha de calendario. */
function dateFromKey(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

const HEADER_ID = 'patient-header';

/**
 * Ficha del paciente: cabecera con lo que se mira antes de atender, banner
 * de alertas clínicas, pestañas por URL (visita de hoy, anamnesis, historia,
 * citas, contable, actividad) y, en la de hoy, un resumen fijo a la derecha.
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

  const [dossier, careProfile, hasEsign, charges, professionalRows] = await Promise.all([
    getPatientDossier(ctx.tenantId, patientKey, { viewerProfessionalId }),
    getCareProfile(ctx.tenantId),
    // Firma digital: sólo las clínicas que la tienen configurada ven la tarjeta.
    tenantHasEsign(ctx.tenantId).catch(() => false),
    listPatientCharges(ctx.tenantId, patientKey, { viewerProfessionalId }).catch(() => []),
    listProfessionals(ctx.tenantId).catch(() => []),
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
  const priority = describePriority(
    {
      ageMonths,
      priorityFlag: person?.priorityFlag ?? false,
      priorityReason: person?.priorityReason ?? null,
    },
    careProfile?.bookingPolicy ?? EMPTY_BOOKING_POLICY,
  );

  // Una nota privada es la valoración personal de quien la escribió: la ve su
  // autor, no el resto del equipo. Vienen de la más nueva a la más vieja.
  const visibleNotes = dossier.notes.filter(
    (n) => !n.private || (ctx.professional && n.professionalId === ctx.professional.id),
  );
  const lastNote = visibleNotes[0] ?? null;
  const lastBehavior =
    lastNote && isSessionBehavior(lastNote.sessionBehavior) ? lastNote.sessionBehavior : null;

  const activeProfessionals = professionalRows
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, fullName: p.fullName }));
  const todaysAppointment =
    dossier.appointments.find(
      (a) => a.status !== 'CANCELLED' && localDateKey(a.startsAt, timezone) === todayKey,
    ) ?? null;
  // Quién firma la nota: el profesional logueado; si no, el de la cita de hoy,
  // el de la última atendida o el primero activo. Con varios se elige en el
  // formulario, así recepción o Futura pueden dejar la nota dictada.
  const professionalIdForNote =
    ctx.professional?.id ??
    todaysAppointment?.professionalId ??
    dossier.appointments.find((a) => a.status === 'COMPLETED')?.professionalId ??
    dossier.appointments[0]?.professionalId ??
    activeProfessionals[0]?.id ??
    null;
  const canWriteToday = ctx.canWriteClinicalNotes && professionalIdForNote !== null;
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
  const scheduleHref = `/dashboard/agenda?paciente=${encodeURIComponent(patientKey)}`;

  const tabItems: PatientTabItem[] = [
    { value: 'visita', href: hrefFor('visita'), label: 'Visita de hoy', shortLabel: 'Hoy' },
    ...(hasAnamnesis
      ? [
          {
            value: 'anamnesis' as const,
            href: hrefFor('anamnesis'),
            label: 'Anamnesis',
            count: `${answered}/${template.length}`,
            mobileCount: pendingAnamnesis > 0 ? String(pendingAnamnesis) : null,
            warn: pendingAnamnesis > 0,
          },
        ]
      : []),
    {
      value: 'historia',
      href: hrefFor('historia'),
      label: 'Historia',
      count: visibleNotes.length > 0 ? String(visibleNotes.length) : null,
    },
    {
      value: 'citas',
      href: hrefFor('citas'),
      label: 'Citas',
      count: dossier.appointments.length > 0 ? String(dossier.appointments.length) : null,
    },
    {
      value: 'contable',
      href: hrefFor('contable'),
      label: 'Contable',
      count: billingTotals.dueCount > 0 ? String(billingTotals.dueCount) : null,
      mobileCount: billingTotals.dueCount > 0 ? String(billingTotals.dueCount) : null,
      warn: billingTotals.dueCount > 0,
    },
    { value: 'actividad', href: hrefFor('actividad'), label: 'Actividad' },
  ];

  // ─── Cabecera ───────────────────────────────────────────────────────────
  const watchouts = person
    ? describeWatchouts(template, person.anamnesis, {
        priorityFlag: person.priorityFlag,
        priorityReason: person.priorityReason,
      })
    : [];
  const now = Date.now();
  const nextAppointment = [...dossier.appointments]
    .reverse()
    .find((a) => a.status !== 'CANCELLED' && a.startsAt.getTime() >= now);
  const lastPast = dossier.appointments.find(
    (a) => a.status === 'COMPLETED' || (a.status !== 'CANCELLED' && a.startsAt.getTime() < now),
  );

  const guardians = person ? activeGuardians(person.guardians) : [];
  const primary = person ? primaryGuardian(person.guardians) : null;
  const phone = primary?.phone?.trim() || dossier.patientPhone;
  const email = primary?.email?.trim() || dossier.patientEmail;
  const holderLabel = primary
    ? `${primary.name || GUARDIAN_ROLE_LABELS[primary.role]} (${GUARDIAN_ROLE_LABELS[primary.role].toLowerCase()})`
    : person?.contactName || null;

  const agendaFact: PatientFact = lastNote
    ? {
        label: 'Última sesión',
        value: `${
          lastBehavior
            ? `${SESSION_BEHAVIOR_FACES[lastBehavior]} ${SESSION_BEHAVIOR_LABELS[lastBehavior]} · `
            : ''
        }${fmtShort.format(lastNote.createdAt)}`,
        sub: nextAppointment ? `Próxima: ${fmt.format(nextAppointment.startsAt)}` : null,
      }
    : nextAppointment
      ? { label: 'Próxima cita', value: fmt.format(nextAppointment.startsAt) }
      : {
          label: 'Próxima cita',
          value: dossier.appointments.length > 0 ? 'Sin cita próxima' : 'Sin citas',
          tone: 'muted',
          action: ctx.canWriteAppointments ? (
            <Link
              href={scheduleHref}
              prefetch={false}
              className="text-[13px] font-semibold text-brand-700 hover:underline"
            >
              Agendar →
            </Link>
          ) : undefined,
        };

  const facts: PatientFact[] = person
    ? [
        {
          label: 'Edad',
          value: age ?? 'Sin fecha de nacimiento',
          emphasis: Boolean(age),
          tone: age ? 'default' : 'muted',
          sub: person.birthDate ? `Nació el ${fmtDay.format(dateFromKey(person.birthDate))}` : null,
        },
        {
          label: 'Tutores',
          value:
            guardians.length > 0
              ? guardians
                  .map((g) => `${GUARDIAN_ROLE_LABELS[g.role]}: ${g.name || '—'}`)
                  .join(' · ')
              : person.contactName || '—',
          sub: holderLabel ? `Titular del teléfono: ${holderLabel}` : null,
          wide: true,
        },
        {
          label: 'Contacto',
          value: phone ? formatPhoneDisplay(phone) : '—',
          sub: email ?? null,
        },
        agendaFact,
      ]
    : [
        {
          label: 'Teléfono',
          value: dossier.patientPhone ? formatPhoneDisplay(dossier.patientPhone) : '—',
        },
        { label: 'Email', value: dossier.patientEmail ?? '—' },
        {
          label: 'Última visita',
          value: lastPast ? fmtShort.format(lastPast.startsAt) : '—',
          tone: lastPast ? 'default' : 'muted',
        },
        agendaFact,
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
    (tab === 'visita' || tab === 'contable') && hasEsign && person
      ? await listPatientConsents(ctx.tenantId, person.id).catch(() => [])
      : [];
  const activity =
    tab === 'actividad'
      ? await listPatientActivity(ctx.tenantId, {
          patientId: person?.id ?? null,
          patientKey,
          chargeIds: charges.map((c) => c.id),
        }).catch(() => [])
      : [];

  // ─── Facturas (pestaña Contable) ────────────────────────────────────────
  const [invoiceRows, invoiceContext] =
    tab === 'contable'
      ? await Promise.all([
          listPatientInvoices(ctx.tenantId, patientKey, person?.id ?? null).catch(() => []),
          getInvoiceContext(ctx.tenantId).catch(() => null),
        ])
      : [[], null];
  const invoiceById = new Map(
    invoiceRows.filter((i) => i.status === 'ISSUED').map((i) => [i.id, i]),
  );
  const chargeByAppointment = new Map(
    charges.filter((c) => c.appointmentId).map((c) => [c.appointmentId as string, c]),
  );
  // Sesiones facturables: pasadas y no anuladas, con el precio del cobro (o
  // del tratamiento) y la factura en la que ya van, si van.
  const invoiceCandidates: InvoiceCandidateView[] = dossier.appointments
    .filter(
      (a) =>
        a.status !== 'CANCELLED' && a.status !== 'NO_SHOW' && a.startsAt.getTime() <= Date.now(),
    )
    .map((a) => {
      const c = chargeByAppointment.get(a.id);
      const inv = c?.invoiceId ? invoiceById.get(c.invoiceId) : null;
      return {
        appointmentId: a.id,
        when: fmt.format(a.startsAt),
        concept: invoiceContext?.defaultConcept ?? a.treatmentName ?? 'Sesión',
        unitCents: c?.amountCents ?? a.treatmentPriceCents ?? null,
        chargeStatus: c?.status === 'PAID' ? 'PAID' : 'PENDING',
        paymentMethod: isPaymentMethod(c?.paymentMethod) ? c.paymentMethod : null,
        invoice: inv ? { id: inv.id, number: inv.number } : null,
      };
    });
  const lastConsent = consents[0] ?? null;
  const invoiceDefaults = {
    name:
      primary?.name ||
      guardians.find((g) => g.name.trim())?.name ||
      person?.contactName ||
      dossier.patientName,
    taxId: primary?.taxId?.trim() || lastConsent?.recipientDni || null,
    address: primary?.address?.trim() || lastConsent?.recipientAddress || null,
    email: email ?? null,
    phone: phone ?? null,
  };
  const invoiceItems: InvoiceListItem[] = invoiceRows.map((i) => ({
    id: i.id,
    number: i.number,
    issuedOnLabel: fmtDay.format(dateFromKey(i.issuedOn)),
    totalCents: i.totalCents,
    status: i.status,
    billToName: i.billToName,
    billToPhone: i.billToPhone,
    billToEmail: i.billToEmail,
    paymentMethod: i.paymentMethod,
    whatsappSentAt: i.whatsappSentAt?.toISOString() ?? null,
    itemsSummary: i.items.map((it) => `${it.quantity}× ${it.concept}`).join(', '),
  }));
  const invoiceByCharge = new Map(
    charges
      .filter((c) => c.invoiceId && invoiceById.has(c.invoiceId))
      .map((c) => [c.id, invoiceById.get(c.invoiceId as string)]),
  );

  // Lo que queda por hacer hoy con este paciente, en una línea cada cosa.
  const pendingItems: TodayItem[] = [];
  if (hasAnamnesis && pendingAnamnesis > 0) {
    pendingItems.push({
      label: `Anamnesis: ${pendingAnamnesis} sin contestar`,
      href: hrefFor('anamnesis'),
      tone: 'warn',
    });
  }
  if (hasEsign && person) {
    const signed = consents.some((c) => c.status === 'SIGNED');
    const sent = consents.some((c) => c.status === 'SENT');
    if (!signed) {
      pendingItems.push({
        label: sent ? 'Consentimiento pendiente de firma' : 'Consentimiento sin enviar',
        href: '#consentimiento',
        tone: 'warn',
      });
    }
  }
  if (billingTotals.dueCount > 0) {
    pendingItems.push({
      label: `${billingTotals.dueCount} ${billingTotals.dueCount === 1 ? 'cobro pendiente' : 'cobros pendientes'}`,
      href: hrefFor('contable'),
      tone: 'info',
    });
  }

  const alertItems = template.filter((i) => i.alert);
  const showAside = tab === 'visita';
  const historyNotes: HistoryNoteView[] = visibleNotes.map((n) => ({
    id: n.id,
    whenLabel: fmt.format(n.createdAt),
    professionalId: n.professionalId,
    professionalName: n.professionalName,
    behavior: isSessionBehavior(n.sessionBehavior) ? n.sessionBehavior : null,
    isPrivate: n.private,
    summary: n.summary,
    symptoms: n.symptoms,
    examination: n.examination,
    treatmentPerformed: n.treatmentPerformed,
    observations: n.observations,
    nextSteps: n.nextSteps,
  }));

  return (
    <>
      <AgendaNav active="pacientes" ctx={{ canManageProfessionals: ctx.canManageProfessionals }} />

      <div className="mt-4 flex flex-col gap-3.5 md:mt-5 md:gap-4">
        <PatientHeader
          id={HEADER_ID}
          breadcrumb={[
            { label: 'Agenda', href: '/dashboard/agenda' },
            { label: 'Pacientes', href: '/dashboard/agenda/pacientes' },
            { label: dossier.patientName },
          ]}
          initials={initialsOf(dossier.patientName)}
          name={dossier.patientName}
          pediatric={Boolean(person && pediatric)}
          badges={
            <>
              {priority.level !== 'NORMAL' && (
                <Badge
                  tone={priority.level === 'VERY_HIGH' ? 'danger' : 'warn'}
                  title={priority.reason ?? undefined}
                >
                  {PRIORITY_LABELS[priority.level]}
                  {priority.source === 'AGE' ? ' · por edad' : ''}
                </Badge>
              )}
              {person?.googleReview && (
                <Badge tone="warn" title="La familia dejó reseña en Google">
                  <Star className="h-3 w-3 fill-amber-500 text-amber-500" /> Reseña en Google
                </Badge>
              )}
            </>
          }
          actions={
            <>
              {phone && (
                <Button asChild variant="secondary" size="sm">
                  <a href={`tel:${phoneDigits(phone).replace(/^/, '+')}`}>
                    <Phone className="h-4 w-4" />
                    <span className="hidden sm:inline">Llamar</span>
                  </a>
                </Button>
              )}
              {phone && (
                <Button asChild variant="secondary" size="sm">
                  <a href={`https://wa.me/${phoneDigits(phone)}`} target="_blank" rel="noreferrer">
                    <MessageCircle className="h-4 w-4" />
                    <span className="hidden sm:inline">WhatsApp</span>
                  </a>
                </Button>
              )}
              {ctx.canWriteAppointments && (
                <Button asChild variant="soft" size="sm">
                  <Link href={scheduleHref} prefetch={false}>
                    <CalendarPlus className="h-4 w-4" />
                    <span className="hidden sm:inline">Agendar</span>
                  </Link>
                </Button>
              )}
              {person && ctx.canWriteAppointments && (
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
                  alertItems={alertItems}
                  answers={person.anamnesis}
                  trigger={
                    <Button variant="secondary" size="sm" aria-label="Editar datos del paciente">
                      <Pencil className="h-4 w-4" />
                      <span className="hidden sm:inline">Editar</span>
                    </Button>
                  }
                />
              )}
            </>
          }
          facts={facts}
        />

        <PatientAlertsBanner
          items={watchouts}
          pendingAnamnesis={hasAnamnesis ? pendingAnamnesis : 0}
          anamnesisHref={hrefFor('anamnesis')}
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

        <PatientTabs
          items={tabItems}
          active={tab}
          headerId={HEADER_ID}
          identity={{ name: dossier.patientName, chips: watchouts.map(formatWatchout) }}
        />

        <div
          className={
            showAside
              ? 'grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]'
              : 'grid items-start gap-5'
          }
        >
          <Card className="min-w-0">
            {tab === 'visita' && (
              <>
                <TodayAppointmentCard
                  appointment={
                    todaysAppointment
                      ? {
                          id: todaysAppointment.id,
                          timeLabel: fmtTime.format(todaysAppointment.startsAt),
                          professionalName: todaysAppointment.professionalName,
                          treatmentName: todaysAppointment.treatmentName,
                          status: todaysAppointment.status,
                          isFirstVisit: pediatric && todaysAppointment.isFirstVisit,
                        }
                      : null
                  }
                  pendingItems={pendingItems}
                  scheduleHref={scheduleHref}
                  canWrite={ctx.canWriteAppointments}
                />
                {canWriteToday && professionalIdForNote ? (
                  <ClinicalNoteForm
                    patientKey={dossier.patientKey}
                    patientName={dossier.patientName}
                    professionalId={professionalIdForNote}
                    professionals={ctx.professional ? [] : activeProfessionals}
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
                ) : (
                  <p className="px-4 py-4 text-[13px] text-zinc-600 md:px-6">
                    La nota de hoy la escribe el profesional que atiende. La historia está en su
                    pestaña.
                  </p>
                )}
              </>
            )}

            {tab === 'anamnesis' && person && (
              <AnamnesisCard
                patientId={person.id}
                template={template}
                answers={person.anamnesis}
                canEdit={ctx.canWriteClinicalNotes}
                updatedAtLabel={
                  person.anamnesisUpdatedAt ? fmt.format(person.anamnesisUpdatedAt) : null
                }
                updatedBy={person.anamnesisUpdatedByEmail}
              />
            )}

            {tab === 'historia' && (
              <HistoryTimeline
                notes={historyNotes}
                pediatric={pediatric}
                writeHref={canWriteToday ? hrefFor('visita') : null}
              />
            )}

            {tab === 'citas' && (
              <div className="flex flex-col gap-2.5 p-4 md:p-6">
                <div className="mb-1.5 flex flex-wrap items-center gap-3">
                  <h2 className="flex-1 text-[18px] font-bold tracking-tight text-zinc-900">
                    Citas{' '}
                    <span className="text-[13px] font-medium text-zinc-600">
                      · {dossier.appointments.length} en total
                    </span>
                  </h2>
                  {ctx.canWriteAppointments && dossier.appointments.length > 0 && (
                    <Button asChild size="sm" variant="secondary">
                      <Link href={scheduleHref} prefetch={false}>
                        <CalendarPlus className="h-4 w-4" /> Agendar cita
                      </Link>
                    </Button>
                  )}
                </div>
                {dossier.appointments.length === 0 ? (
                  <EmptyState
                    icon={<CalendarDays className="h-5 w-5" />}
                    title="Todavía sin citas"
                    description="Desde aquí se le da la primera hora con sus datos ya puestos."
                    action={
                      ctx.canWriteAppointments ? (
                        <Button asChild>
                          <Link href={scheduleHref} prefetch={false}>
                            <CalendarPlus className="h-4 w-4" /> Agendar cita
                          </Link>
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {dossier.appointments.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-start gap-2.5 rounded-[14px] border border-(--color-border) p-3"
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
                          <p className="mt-0.5 truncate text-[12px] text-zinc-600">
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
              <>
                <InvoicesCard
                  invoices={invoiceItems}
                  canWrite={ctx.canWriteAppointments}
                  canVoid={ctx.canManageProfessionals}
                  dialog={{
                    patientKey,
                    patientId: person?.id ?? null,
                    patientName: person?.fullName ?? dossier.patientName,
                    clinicName: invoiceContext?.clinicName ?? 'la clínica',
                    issuerName: invoiceContext?.issuer.name ?? 'la clínica',
                    vatRate: invoiceContext?.issuer.vatRate ?? 0,
                    defaults: invoiceDefaults,
                    candidates: invoiceCandidates,
                    todayKey,
                  }}
                />
                <BillingPanel
                  lines={billingViews.map((l) => {
                    const inv = l.chargeId ? invoiceByCharge.get(l.chargeId) : null;
                    return { ...l, invoice: inv ? { id: inv.id, number: inv.number } : null };
                  })}
                  todayKey={todayKey}
                  canWrite={ctx.canWriteAppointments}
                />
              </>
            )}

            {tab === 'actividad' && (
              <div className="p-4 md:p-6">
                <h2 className="mb-1 text-[18px] font-bold tracking-tight text-zinc-900">
                  Actividad
                </h2>
                <p className="mb-4 text-[13px] text-zinc-600">
                  Quién cambió qué en esta ficha y cuándo. Datos, anamnesis, notas, consentimiento y
                  cobros.
                </p>
                {activity.length === 0 ? (
                  <EmptyState
                    icon={<Activity className="h-5 w-5" />}
                    title="Sin actividad registrada"
                    description="A partir de ahora, cada cambio en la ficha queda anotado aquí con su autor."
                  />
                ) : (
                  <ol className="divide-y divide-(--color-border-subtle)">
                    {activity.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5"
                      >
                        <span className="w-[150px] shrink-0 text-[12px] tabular-nums text-zinc-600">
                          {fmt.format(entry.createdAt)}
                        </span>
                        <span className="min-w-0 flex-1 text-[14px] text-zinc-800">
                          {describeActivity(entry)}
                        </span>
                        <span className="text-[12px] text-zinc-600">
                          {entry.actorEmail ?? 'Asistente / sistema'}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </Card>

          {showAside && (
            <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[132px]">
              {lastNote && (
                <div className="hidden flex-col gap-2 rounded-[22px] border border-(--color-border) bg-white p-[18px] shadow-[var(--shadow-soft)] lg:flex">
                  <span className="text-[12px] font-bold uppercase tracking-[0.14em] text-zinc-600">
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

              {person && careProfile && (
                <Card>
                  <CardTopbar
                    icon={<Star className="h-4 w-4" />}
                    title="Prioridad y reseña"
                    subtitle="Lo leen los asistentes"
                    tone="honey"
                  />
                  <CardContent>
                    <PatientMarks
                      patientId={person.id}
                      priorityFlag={person.priorityFlag}
                      priorityReason={person.priorityReason}
                      googleReview={person.googleReview}
                      priority={priority}
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
                      primary?.name ||
                      guardians.find((g) => g.name.trim())?.name ||
                      person.contactName ||
                      '',
                    phone: phone ?? '',
                    email: email ?? '',
                    relation: primary
                      ? GUARDIAN_ROLE_LABELS[primary.role]
                      : (guardians[0] && GUARDIAN_ROLE_LABELS[guardians[0].role]) || null,
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
                    whatsappSent: Boolean(c.whatsappMessageId),
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
