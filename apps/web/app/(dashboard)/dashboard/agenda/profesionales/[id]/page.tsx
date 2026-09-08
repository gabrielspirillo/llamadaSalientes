import { AgendaEnabledToggle } from '@/components/agenda/agenda-toggle';
import { DeleteProfessionalButton } from '@/components/agenda/professional-delete-button';
import { ProfessionalDialog } from '@/components/agenda/professional-dialog';
import { ScheduleEditor } from '@/components/agenda/schedule-editor';
import { TimeOffEditor } from '@/components/agenda/time-off-editor';
import { TreatmentsPicker } from '@/components/agenda/treatments-picker';
import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardTopbar } from '@/components/ui/card';
import { getAgendaContext } from '@/lib/agenda/auth';
import { getProfessionalDetail, resolveTimezone } from '@/lib/agenda/queries';
import { WEEKDAY_SHORT, minutesToHHMM } from '@/lib/agenda/shared';
import { localDateKey } from '@/lib/tasks/tz';
import { CalendarClock, CalendarOff, Clock, Stethoscope, UserCog } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AgendaNav } from '../../agenda-nav';

export const dynamic = 'force-dynamic';

export default async function ProfesionalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getAgendaContext();
  if (!ctx.canManageProfessionals) redirect('/dashboard/agenda');

  const detail = await getProfessionalDetail(ctx.tenantId, id);
  if (!detail) notFound();

  const timezone = await resolveTimezone(ctx.tenantId, detail.professional);
  const p = detail.professional;

  // Los bloqueos se formatean en el servidor con la timezone de la clínica: si
  // lo hiciera el navegador, cada uno vería las vacaciones a una hora distinta.
  const dateFmt = new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const blocks = detail.timeOff.map((b) => ({
    id: b.id,
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    allDay: b.allDay,
    kind: b.kind,
    reason: b.reason,
    label: b.allDay
      ? `${localDateKey(b.startsAt, timezone)} → ${localDateKey(new Date(b.endsAt.getTime() - 1), timezone)}`
      : `${dateFmt.format(b.startsAt)} → ${dateFmt.format(b.endsAt)}`,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Agenda · Profesional"
        icon={<UserCog className="h-5 w-5" />}
        title={p.fullName}
        description={p.specialty ?? 'Sin especialidad registrada'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href={`/dashboard/agenda?view=week&prof=${p.id}`}>
                <CalendarClock className="h-4 w-4" /> Ver su agenda
              </Link>
            </Button>
            <ProfessionalDialog
              professional={{
                id: p.id,
                fullName: p.fullName,
                email: p.email ?? '',
                phone: p.phone ?? '',
                specialty: p.specialty ?? '',
                licenseNumber: p.licenseNumber ?? '',
                color: p.color,
                agendaEnabled: p.agendaEnabled,
                acceptsOnlineBooking: p.acceptsOnlineBooking,
                panelAccess: p.panelAccess,
                slotGranularityMinutes: p.slotGranularityMinutes,
                bufferMinutes: p.bufferMinutes,
                minNoticeHours: p.minNoticeHours,
                maxAdvanceDays: p.maxAdvanceDays,
                linkUserEmail: detail.linkedUserEmail ?? '',
              }}
              trigger={
                <Button size="sm" variant="soft">
                  Editar datos
                </Button>
              }
            />
            <DeleteProfessionalButton
              professionalId={p.id}
              fullName={p.fullName}
              active={p.active}
            />
          </div>
        }
      />

      <AgendaNav active="profesionales" ctx={{ canManageProfessionals: true }} />

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardTopbar
            icon={<Clock className="h-4 w-4" />}
            title="Estado de la agenda"
            subtitle="Lo que ven recepción y los agentes"
          />
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[14px] text-zinc-600">Agenda</span>
              <AgendaEnabledToggle
                professionalId={p.id}
                enabled={p.agendaEnabled}
                disabled={!p.active}
              />
            </div>
            <dl className="space-y-2 text-[13px]">
              <div className="flex items-center justify-between">
                <dt className="text-zinc-500">Reservas de agentes</dt>
                <dd>
                  <Badge tone={p.acceptsOnlineBooking ? 'success' : 'neutral'}>
                    {p.acceptsOnlineBooking ? 'Permitidas' : 'Sólo recepción'}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-zinc-500">Rejilla</dt>
                <dd className="tabular-nums text-zinc-700">{p.slotGranularityMinutes} min</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-zinc-500">Descanso entre citas</dt>
                <dd className="tabular-nums text-zinc-700">{p.bufferMinutes} min</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-zinc-500">Antelación mínima</dt>
                <dd className="tabular-nums text-zinc-700">{p.minNoticeHours} h</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-zinc-500">Reservable hasta</dt>
                <dd className="tabular-nums text-zinc-700">{p.maxAdvanceDays} días</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-zinc-500">Zona horaria</dt>
                <dd className="text-zinc-700">{timezone}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-zinc-500">Usuario del panel</dt>
                <dd className="truncate text-zinc-700">
                  {detail.linkedUserEmail ?? 'Sin vincular'}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-zinc-500">Acceso</dt>
                <dd>
                  <Badge tone={p.panelAccess === 'AGENDA_ONLY' ? 'info' : 'accent'}>
                    {p.panelAccess === 'AGENDA_ONLY' ? 'Sólo su agenda' : 'Panel completo'}
                  </Badge>
                </dd>
              </div>
            </dl>

            {detail.shifts.length > 0 && (
              <div className="rounded-[14px] bg-zinc-50 p-3">
                <p className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-zinc-500">
                  Resumen semanal
                </p>
                <ul className="space-y-0.5 text-[13px] text-zinc-700">
                  {detail.shifts.map((s) => (
                    <li key={s.id} className="tabular-nums">
                      <span className="inline-block w-10 font-semibold">
                        {WEEKDAY_SHORT[s.weekday]}
                      </span>
                      {minutesToHHMM(s.startMinute)}–{minutesToHHMM(s.endMinute)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardTopbar
              icon={<Clock className="h-4 w-4" />}
              title="Horario de trabajo"
              subtitle="Los días y las horas en las que se le pueden dar citas"
            />
            <CardContent>
              <ScheduleEditor
                professionalId={p.id}
                initial={detail.shifts.map((s) => ({
                  weekday: s.weekday,
                  startMinute: s.startMinute,
                  endMinute: s.endMinute,
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardTopbar
              icon={<Stethoscope className="h-4 w-4" />}
              title="Tratamientos que realiza"
              subtitle="Del catálogo de la clínica"
              tone="mint"
            />
            <CardContent>
              <TreatmentsPicker
                professionalId={p.id}
                catalog={detail.catalog}
                assigned={detail.treatments.map((t) => ({
                  treatmentId: t.treatmentId,
                  durationOverrideMinutes: t.durationOverrideMinutes,
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardTopbar
              icon={<CalendarOff className="h-4 w-4" />}
              title="Bloqueos y ausencias"
              subtitle="Días u horas en los que no pasa consulta"
              tone="coral"
            />
            <CardContent>
              <TimeOffEditor professionalId={p.id} blocks={blocks} timezone={timezone} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
