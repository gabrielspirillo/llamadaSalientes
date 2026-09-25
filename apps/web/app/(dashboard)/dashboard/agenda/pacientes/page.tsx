import { PatientDialog } from '@/components/agenda/patient-dialog';
import { PatientSignalBadges } from '@/components/agenda/patient-signals';
import { RemovePatientButton } from '@/components/agenda/remove-patient-button';
import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/input';
import { HeadRow, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { getAgendaContext } from '@/lib/agenda/auth';
import {
  countRedFlagsByPatientKey,
  listAgendaPatients,
  listProfessionals,
  resolveTimezone,
} from '@/lib/agenda/queries';
import { describeAge } from '@/lib/care-profile/policy';
import { getCareProfile } from '@/lib/care-profile/queries';
import { EMPTY_RED_FLAGS, type RedFlagCounts } from '@/lib/care-profile/signals';
import { localDateKey } from '@/lib/tasks/tz';
import { Contact, Search } from 'lucide-react';
import Link from 'next/link';
import { AgendaNav } from '../agenda-nav';

export const dynamic = 'force-dynamic';

export default async function AgendaPacientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; prof?: string }>;
}) {
  const { q, prof } = await searchParams;
  const ctx = await getAgendaContext();
  const timezone = await resolveTimezone(ctx.tenantId, null);
  const todayKey = localDateKey(new Date(), timezone);

  // Con perfil de atención, el paciente es una persona con ficha propia: se
  // puede dar de alta desde aquí y se le ve la edad. Sin perfil, la lista es la
  // de siempre.
  const careProfile = await getCareProfile(ctx.tenantId);

  const professionals = ctx.scope === 'OWN' ? [] : await listProfessionals(ctx.tenantId);

  // Un profesional restringido ve SUS pacientes, y el filtro NO sale de la URL:
  // lo que no es suyo no llega ni al HTML. Para el resto del equipo, "los
  // pacientes de la Dra. Ruiz" es un filtro más, validado contra la lista.
  const filtroProfesional =
    ctx.scope === 'OWN'
      ? ctx.professional?.id
      : professionals.some((p) => p.id === prof)
        ? prof
        : undefined;

  const patients = await listAgendaPatients(ctx.tenantId, {
    professionalId: filtroProfesional,
    search: q,
  });
  // Banderas rojas (faltas y cancelaciones de la familia): sólo con perfil. Una
  // consulta agrupada para toda la lista, contando todas sus citas.
  const redFlagsByKey = careProfile
    ? await countRedFlagsByPatientKey(
        ctx.tenantId,
        patients.map((p) => p.patientKey),
      ).catch(() => new Map<string, RedFlagCounts>())
    : new Map<string, RedFlagCounts>();

  const fmt = new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <>
      <PageHeader
        eyebrow="Agenda"
        icon={<Contact className="h-5 w-5" />}
        title={ctx.scope === 'OWN' ? 'Mis pacientes' : 'Pacientes de la agenda'}
        description="Quién ha pasado por consulta, cuándo vuelve y su historia clínica."
        actions={
          careProfile && ctx.canWriteAppointments ? <PatientDialog mode="create" /> : undefined
        }
      />

      <AgendaNav active="pacientes" ctx={{ canManageProfessionals: ctx.canManageProfessionals }} />

      <form
        className="mt-5 flex max-w-2xl flex-wrap items-center gap-2"
        action="/dashboard/agenda/pacientes"
      >
        <Input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Buscar por nombre, teléfono o email"
          className="max-w-xs"
        />
        {professionals.length > 0 && (
          <Select
            name="prof"
            defaultValue={filtroProfesional ?? ''}
            className="w-auto min-w-[200px]"
          >
            <option value="">Todos los profesionales</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </Select>
        )}
        <Button type="submit" variant="secondary">
          <Search className="h-4 w-4" /> Buscar
        </Button>
      </form>

      <div className="mt-5">
        {patients.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Contact className="h-5 w-5" />}
              title={q ? 'Ningún paciente coincide' : 'Todavía no hay pacientes en la agenda'}
              description={
                q
                  ? 'Prueba con otro nombre o teléfono.'
                  : 'En cuanto se agende la primera cita, el paciente aparece aquí con su historia clínica.'
              }
            />
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <TableWrap>
              <Table>
                <THead>
                  <HeadRow>
                    <TH>Paciente</TH>
                    {careProfile && <TH>Edad</TH>}
                    <TH>Contacto</TH>
                    <TH>Citas</TH>
                    <TH>Última visita</TH>
                    <TH>Próxima</TH>
                    <TH>Historia</TH>
                    <TH />
                  </HeadRow>
                </THead>
                <tbody>
                  {patients.map((p) => (
                    <TR key={p.patientKey}>
                      <TD>
                        <span className="text-[15px] font-bold text-zinc-900">{p.patientName}</span>
                        {p.priorityFlag && (
                          <Badge tone="warn" size="sm" className="ml-2">
                            Prioritario
                          </Badge>
                        )}
                        {careProfile && (
                          <PatientSignalBadges
                            size="sm"
                            className="ml-2 align-middle"
                            redFlags={{
                              ...(redFlagsByKey.get(p.patientKey) ?? EMPTY_RED_FLAGS),
                              prior: p.priorRedFlags,
                            }}
                            hesitant={p.hesitant}
                            hesitantNote={p.hesitantNote}
                          />
                        )}
                      </TD>
                      {careProfile && (
                        <TD className="text-[13px] text-zinc-600">
                          {p.birthDate ? (describeAge(p.birthDate, todayKey) ?? '—') : '—'}
                        </TD>
                      )}
                      <TD className="text-[13px] text-zinc-600">
                        {p.patientPhone ?? p.patientEmail ?? '—'}
                      </TD>
                      <TD className="tabular-nums text-zinc-600">{p.totalAppointments}</TD>
                      <TD className="text-[13px] text-zinc-600">
                        {p.lastVisitAt ? fmt.format(p.lastVisitAt) : '—'}
                      </TD>
                      <TD className="text-[13px]">
                        {p.nextVisitAt ? (
                          <Badge tone="success">{fmt.format(p.nextVisitAt)}</Badge>
                        ) : (
                          <span className="text-zinc-400">Sin próxima cita</span>
                        )}
                      </TD>
                      <TD className="tabular-nums text-zinc-600">
                        {p.noteCount > 0 ? `${p.noteCount} nota(s)` : '—'}
                      </TD>
                      <TD className="text-right">
                        <div className="inline-flex items-center gap-1">
                          <Button asChild variant="ghost" size="sm">
                            <Link
                              href={`/dashboard/agenda/pacientes/${encodeURIComponent(p.patientKey)}`}
                            >
                              Abrir ficha
                            </Link>
                          </Button>
                          {/* Sólo sin historia y sólo admin: las altas de prueba del asistente. */}
                          {ctx.canManageProfessionals &&
                            p.totalAppointments === 0 &&
                            p.noteCount === 0 &&
                            (p.patientId !== null || p.patientKey.startsWith('tel:')) && (
                              <RemovePatientButton patientKey={p.patientKey} name={p.patientName} />
                            )}
                        </div>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </Card>
        )}
      </div>
    </>
  );
}
