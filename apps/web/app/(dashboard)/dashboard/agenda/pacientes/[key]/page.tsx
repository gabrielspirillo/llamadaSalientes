import { AnamnesisCard } from '@/components/agenda/anamnesis-card';
import { ClinicalNoteForm } from '@/components/agenda/clinical-note-form';
import { ConsentCard } from '@/components/agenda/consent-card';
import { PatientDialog } from '@/components/agenda/patient-dialog';
import { PatientMarks } from '@/components/agenda/patient-marks';
import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardTopbar } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { getAgendaContext } from '@/lib/agenda/auth';
import { getPatientDossier, resolveTimezone } from '@/lib/agenda/queries';
import { STATUS_LABELS } from '@/lib/agenda/shared';
import {
  SESSION_BEHAVIOR_FACES,
  SESSION_BEHAVIOR_LABELS,
  ageAt,
  describeAge,
  describeGuardians,
  isSessionBehavior,
  priorityLevel,
} from '@/lib/care-profile/policy';
import { getCareProfile } from '@/lib/care-profile/queries';
import { listPatientConsents, tenantHasEsign } from '@/lib/consents/service';
import { localDateKey } from '@/lib/tasks/tz';
import { Baby, CalendarDays, Lock, NotebookPen, User } from 'lucide-react';
import { notFound } from 'next/navigation';
import { AgendaNav } from '../../agenda-nav';

export const dynamic = 'force-dynamic';

/** Ficha del paciente: sus citas y su historia clínica. */
export default async function PacienteDossierPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ nota?: string }>;
}) {
  const { key } = await params;
  const { nota } = await searchParams;
  const patientKey = decodeURIComponent(key);

  const ctx = await getAgendaContext();
  const timezone = await resolveTimezone(ctx.tenantId, null);

  const [dossier, careProfile, hasEsign] = await Promise.all([
    getPatientDossier(ctx.tenantId, patientKey, {
      viewerProfessionalId: ctx.scope === 'OWN' ? ctx.professional?.id : undefined,
    }),
    getCareProfile(ctx.tenantId),
    // Firma digital: sólo las clínicas que la tienen configurada ven la tarjeta.
    tenantHasEsign(ctx.tenantId).catch(() => false),
  ]);
  if (!dossier) notFound();

  const consents =
    hasEsign && dossier.patient
      ? await listPatientConsents(ctx.tenantId, dossier.patient.id).catch(() => [])
      : [];

  const fmt = new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const fmtDay = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  // El paciente como persona: edad con número, tutores, anamnesis y marcas.
  // Sólo existe en las clínicas con perfil; para el resto `patient` es null y
  // la ficha es la de siempre.
  const person = dossier.patient;
  const pediatric = careProfile?.profile === 'PEDIATRIC';
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
  // autor, no el resto del equipo.
  const visibleNotes = dossier.notes.filter(
    (n) => !n.private || (ctx.professional && n.professionalId === ctx.professional.id),
  );
  // La consulta las trae de la más nueva a la más vieja. La clínica pediátrica
  // pidió la historia en orden cronológico: se lee de arriba abajo como pasó.
  const orderedNotes = pediatric ? [...visibleNotes].reverse() : visibleNotes;
  const lastBehavior =
    visibleNotes.map((n) => n.sessionBehavior).find((b) => isSessionBehavior(b)) ?? null;

  const professionalIdForNote =
    ctx.professional?.id ??
    dossier.appointments.find((a) => a.status === 'COMPLETED')?.professionalId ??
    dossier.appointments[0]?.professionalId ??
    null;

  const seedAppointment = nota ? (dossier.appointments.find((a) => a.id === nota) ?? null) : null;

  const headerDescription = person
    ? [
        age,
        person.birthDate
          ? `nació el ${fmtDay.format(new Date(`${person.birthDate}T00:00:00Z`))}`
          : null,
        dossier.patientPhone ? `tutor: ${dossier.patientPhone}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'Sin fecha de nacimiento ni contacto'
    : [dossier.patientPhone, dossier.patientEmail].filter(Boolean).join(' · ') ||
      'Sin datos de contacto';

  return (
    <>
      <PageHeader
        eyebrow="Agenda · Paciente"
        icon={person ? <Baby className="h-5 w-5" /> : <User className="h-5 w-5" />}
        title={dossier.patientName}
        description={headerDescription}
        actions={
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
            />
          ) : undefined
        }
      />

      <AgendaNav active="pacientes" ctx={{ canManageProfessionals: ctx.canManageProfessionals }} />

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          {person && careProfile && careProfile.anamnesisTemplate.length > 0 && (
            <AnamnesisCard
              patientId={person.id}
              template={careProfile.anamnesisTemplate}
              answers={person.anamnesis}
              canEdit={ctx.canWriteClinicalNotes}
            />
          )}

          <Card>
            <CardTopbar
              icon={<NotebookPen className="h-4 w-4" />}
              title="Historia clínica"
              subtitle={
                pediatric
                  ? 'Las visitas, en orden cronológico'
                  : 'Lo que se anotó después de atender'
              }
              tone="mint"
            />
            <CardContent>
              {orderedNotes.length === 0 ? (
                <EmptyState
                  icon={<NotebookPen className="h-5 w-5" />}
                  title="Todavía no hay notas"
                  description="Después de atender al paciente, anota aquí el diagnóstico y lo que toca la próxima vez."
                />
              ) : (
                <ul className="space-y-4">
                  {orderedNotes.map((n) => {
                    const behavior = isSessionBehavior(n.sessionBehavior)
                      ? n.sessionBehavior
                      : null;
                    return (
                      <li
                        key={n.id}
                        className="rounded-[14px] border border-[--color-border] bg-white p-4"
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-bold text-zinc-800">
                            {n.professionalName}
                          </span>
                          <span className="text-[12px] text-zinc-500">
                            {fmt.format(n.createdAt)}
                          </span>
                          {n.private && (
                            <Badge tone="neutral">
                              <Lock className="mr-1 h-3 w-3" /> Privada
                            </Badge>
                          )}
                          {behavior && (
                            <Badge tone="neutral" title="Cómo se portó en la sesión">
                              <span aria-hidden>{SESSION_BEHAVIOR_FACES[behavior]}</span>{' '}
                              {SESSION_BEHAVIOR_LABELS[behavior]}
                            </Badge>
                          )}
                        </div>
                        {n.symptoms && (
                          <p className="mb-1.5 whitespace-pre-line text-[13px] text-zinc-700">
                            <span className="font-semibold">Síntomas:</span> {n.symptoms}
                          </p>
                        )}
                        {n.examination && (
                          <p className="mb-1.5 whitespace-pre-line text-[13px] text-zinc-700">
                            <span className="font-semibold">Exploración:</span> {n.examination}
                          </p>
                        )}
                        {n.treatmentPerformed && pediatric && (
                          <p className="mb-1.5 text-[13px] text-zinc-700">
                            <span className="font-semibold">Tratamiento:</span>{' '}
                            {n.treatmentPerformed}
                          </p>
                        )}
                        <p className="text-[14px] font-semibold text-zinc-900">
                          {pediatric && <span className="text-zinc-500">Diagnóstico: </span>}
                          {n.summary}
                        </p>
                        {n.treatmentPerformed && !pediatric && (
                          <p className="mt-1.5 text-[13px] text-zinc-700">
                            <span className="font-semibold">Se hizo:</span> {n.treatmentPerformed}
                          </p>
                        )}
                        {n.observations && (
                          <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-zinc-600">
                            {n.observations}
                          </p>
                        )}
                        {n.nextSteps && (
                          <p className="mt-2 rounded-[10px] bg-brand-50 p-2.5 text-[13px] text-brand-800">
                            <span className="font-semibold">Próximo paso:</span> {n.nextSteps}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {ctx.canWriteClinicalNotes && professionalIdForNote && (
            <Card>
              <CardTopbar
                icon={<NotebookPen className="h-4 w-4" />}
                title="Nueva nota clínica"
                subtitle="Queda en la historia del paciente"
              />
              <CardContent>
                <ClinicalNoteForm
                  patientKey={dossier.patientKey}
                  patientName={dossier.patientName}
                  professionalId={professionalIdForNote}
                  template={pediatric ? 'PEDIATRIC' : 'DEFAULT'}
                  appointments={dossier.appointments
                    .filter((a) => a.status !== 'CANCELLED')
                    .slice(0, 20)
                    .map((a) => ({
                      id: a.id,
                      label: `${fmt.format(a.startsAt)} · ${a.professionalName}${a.treatmentName ? ` · ${a.treatmentName}` : ''}`,
                      professionalId: a.professionalId,
                    }))}
                  defaultAppointmentId={seedAppointment?.id ?? null}
                />
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-5 lg:col-span-2">
          {person && (
            <Card>
              <CardTopbar
                icon={<Baby className="h-4 w-4" />}
                title="Datos del paciente"
                subtitle={
                  person.guardians.length > 0
                    ? describeGuardians(person.guardians)
                    : 'Sin tutores anotados'
                }
                tone="honey"
              />
              <CardContent>
                <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                  <dt className="text-zinc-500">Edad</dt>
                  <dd className="font-semibold text-zinc-800">{age ?? '—'}</dd>
                  <dt className="text-zinc-500">Fecha de nacimiento</dt>
                  <dd className="font-semibold text-zinc-800">
                    {person.birthDate
                      ? fmtDay.format(new Date(`${person.birthDate}T00:00:00Z`))
                      : '—'}
                  </dd>
                  <dt className="text-zinc-500">Tutor</dt>
                  <dd className="font-semibold text-zinc-800">
                    {[person.contactName, person.contactPhone].filter(Boolean).join(' · ') || '—'}
                  </dd>
                  {person.notes && (
                    <>
                      <dt className="text-zinc-500">Notas</dt>
                      <dd className="whitespace-pre-line text-zinc-700">{person.notes}</dd>
                    </>
                  )}
                </dl>
                <PatientMarks
                  patientId={person.id}
                  priorityFlag={person.priorityFlag}
                  priorityReason={person.priorityReason}
                  googleReview={person.googleReview}
                  needsHumanReview={person.needsHumanReview}
                  reviewReason={person.reviewReason}
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

          <Card>
            <CardTopbar
              icon={<CalendarDays className="h-4 w-4" />}
              title="Citas"
              subtitle={`${dossier.appointments.length} en total`}
              tone="sky"
            />
            <CardContent>
              {dossier.appointments.length === 0 ? (
                <EmptyState
                  icon={<CalendarDays className="h-5 w-5" />}
                  title="Todavía sin citas"
                  description="Cuando se le dé hora desde el calendario, aparece aquí."
                />
              ) : (
                <ul className="space-y-2.5">
                  {dossier.appointments.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-start gap-2.5 rounded-[14px] border border-[--color-border] p-3"
                    >
                      <span
                        aria-hidden
                        className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: a.professionalColor }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-zinc-800">
                          {fmt.format(a.startsAt)}
                        </p>
                        <p className="truncate text-[12px] text-zinc-500">
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
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
