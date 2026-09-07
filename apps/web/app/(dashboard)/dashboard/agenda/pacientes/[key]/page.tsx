import { ClinicalNoteForm } from '@/components/agenda/clinical-note-form';
import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardTopbar } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { getAgendaContext } from '@/lib/agenda/auth';
import { getPatientDossier, resolveTimezone } from '@/lib/agenda/queries';
import { STATUS_LABELS } from '@/lib/agenda/shared';
import { CalendarDays, Lock, NotebookPen, User } from 'lucide-react';
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

  const dossier = await getPatientDossier(ctx.tenantId, patientKey, {
    viewerProfessionalId: ctx.scope === 'OWN' ? ctx.professional?.id : undefined,
  });
  if (!dossier) notFound();

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

  // Una nota privada es la valoración personal de quien la escribió: la ve su
  // autor, no el resto del equipo.
  const visibleNotes = dossier.notes.filter(
    (n) => !n.private || (ctx.professional && n.professionalId === ctx.professional.id),
  );

  const professionalIdForNote =
    ctx.professional?.id ??
    dossier.appointments.find((a) => a.status === 'COMPLETED')?.professionalId ??
    dossier.appointments[0]?.professionalId ??
    null;

  const seedAppointment = nota ? (dossier.appointments.find((a) => a.id === nota) ?? null) : null;

  return (
    <>
      <PageHeader
        eyebrow="Agenda · Paciente"
        icon={<User className="h-5 w-5" />}
        title={dossier.patientName}
        description={
          [dossier.patientPhone, dossier.patientEmail].filter(Boolean).join(' · ') ||
          'Sin datos de contacto'
        }
      />

      <AgendaNav active="pacientes" ctx={{ canManageProfessionals: ctx.canManageProfessionals }} />

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <Card>
            <CardTopbar
              icon={<NotebookPen className="h-4 w-4" />}
              title="Historia clínica"
              subtitle="Lo que se anotó después de atender"
              tone="mint"
            />
            <CardContent>
              {visibleNotes.length === 0 ? (
                <EmptyState
                  icon={<NotebookPen className="h-5 w-5" />}
                  title="Todavía no hay notas"
                  description="Después de atender al paciente, anota aquí el diagnóstico y lo que toca la próxima vez."
                />
              ) : (
                <ul className="space-y-4">
                  {visibleNotes.map((n) => (
                    <li
                      key={n.id}
                      className="rounded-[14px] border border-[--color-border] bg-white p-4"
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-bold text-zinc-800">
                          {n.professionalName}
                        </span>
                        <span className="text-[12px] text-zinc-500">{fmt.format(n.createdAt)}</span>
                        {n.private && (
                          <Badge tone="neutral">
                            <Lock className="mr-1 h-3 w-3" /> Privada
                          </Badge>
                        )}
                      </div>
                      <p className="text-[14px] font-semibold text-zinc-900">{n.summary}</p>
                      {n.treatmentPerformed && (
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
                  ))}
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

        <Card className="lg:col-span-2">
          <CardTopbar
            icon={<CalendarDays className="h-4 w-4" />}
            title="Citas"
            subtitle={`${dossier.appointments.length} en total`}
            tone="sky"
          />
          <CardContent>
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
                    </p>
                  </div>
                  <Badge tone={a.status === 'CANCELLED' ? 'danger' : 'neutral'}>
                    {STATUS_LABELS[a.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
