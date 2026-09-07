import { AgendaEnabledToggle } from '@/components/agenda/agenda-toggle';
import { ProfessionalDialog } from '@/components/agenda/professional-dialog';
import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Callout, EmptyState } from '@/components/ui/feedback';
import { HeadRow, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { getAgendaContext } from '@/lib/agenda/auth';
import { listProfessionals } from '@/lib/agenda/queries';
import { db } from '@/lib/db/client';
import { treatments } from '@/lib/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { Info, Plus, Stethoscope, UserCog } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AgendaNav } from '../agenda-nav';

export const dynamic = 'force-dynamic';

export default async function ProfesionalesPage() {
  const ctx = await getAgendaContext();
  // La configuración de agendas es del administrador de la clínica (y de
  // Futura). El gate está también en cada acción del servidor; esto sólo evita
  // enseñar una página que no se puede usar.
  if (!ctx.canManageProfessionals) redirect('/dashboard/agenda');

  const [rows, catalog] = await Promise.all([
    listProfessionals(ctx.tenantId, { includeInactive: true }),
    db
      .select({ id: treatments.id, name: treatments.name })
      .from(treatments)
      .where(and(eq(treatments.tenantId, ctx.tenantId), eq(treatments.active, true)))
      .orderBy(asc(treatments.name)),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Agenda"
        icon={<UserCog className="h-5 w-5" />}
        title="Profesionales"
        description="Quién pasa consulta, qué hace cada uno y cuándo trabaja."
        actions={
          <ProfessionalDialog
            trigger={
              <Button size="sm">
                <Plus className="h-4 w-4" /> Nuevo profesional
              </Button>
            }
          />
        }
      />

      <AgendaNav active="profesionales" ctx={{ canManageProfessionals: true }} />

      {catalog.length === 0 && (
        <Callout tone="brand" icon={<Info className="h-4 w-4" />} className="mt-5">
          Todavía no hay tratamientos en el catálogo. Cárgalos en{' '}
          <Link href="/dashboard/treatments" className="font-semibold underline">
            Tratamientos
          </Link>{' '}
          y luego asigna a cada profesional los que realiza.
        </Callout>
      )}

      <div className="mt-5">
        {rows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Stethoscope className="h-5 w-5" />}
              title="Aún no hay profesionales"
              description="Da de alta al equipo clínico para poder abrir sus agendas y empezar a dar citas."
              action={
                <ProfessionalDialog
                  trigger={
                    <Button size="sm">
                      <Plus className="h-4 w-4" /> Nuevo profesional
                    </Button>
                  }
                />
              }
            />
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <TableWrap>
              <Table>
                <THead>
                  <HeadRow>
                    <TH>Profesional</TH>
                    <TH>Tratamientos</TH>
                    <TH>Horario</TH>
                    <TH>Acceso</TH>
                    <TH>Agenda</TH>
                    <TH />
                  </HeadRow>
                </THead>
                <tbody>
                  {rows.map((p) => (
                    <TR key={p.id}>
                      <TD>
                        <div className="flex items-center gap-2.5">
                          <span
                            aria-hidden
                            className="inline-block h-3 w-3 shrink-0 rounded-full"
                            style={{ backgroundColor: p.color }}
                          />
                          <div className="min-w-0">
                            <div className="truncate text-[15px] font-bold text-zinc-900">
                              {p.fullName}
                              {!p.active && (
                                <Badge tone="neutral" className="ml-2">
                                  De baja
                                </Badge>
                              )}
                            </div>
                            <div className="truncate text-[13px] text-zinc-500">
                              {p.specialty ?? 'Sin especialidad'}
                            </div>
                          </div>
                        </div>
                      </TD>
                      <TD className="tabular-nums text-zinc-600">
                        {p.treatmentCount > 0 ? `${p.treatmentCount}` : '—'}
                      </TD>
                      <TD className="tabular-nums text-zinc-600">
                        {p.shiftCount > 0 ? `${p.shiftCount} franjas` : 'Sin horario'}
                      </TD>
                      <TD>
                        {p.linkedUserEmail ? (
                          <div className="min-w-0">
                            <div className="truncate text-[13px] text-zinc-700">
                              {p.linkedUserEmail}
                            </div>
                            <Badge tone={p.panelAccess === 'AGENDA_ONLY' ? 'info' : 'accent'}>
                              {p.panelAccess === 'AGENDA_ONLY'
                                ? 'Sólo su agenda'
                                : 'Panel completo'}
                            </Badge>
                          </div>
                        ) : (
                          <span className="text-[13px] text-zinc-400">Sin usuario</span>
                        )}
                      </TD>
                      <TD>
                        <AgendaEnabledToggle
                          professionalId={p.id}
                          enabled={p.agendaEnabled}
                          disabled={!p.active}
                        />
                      </TD>
                      <TD className="text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/dashboard/agenda/profesionales/${p.id}`}>Configurar</Link>
                        </Button>
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
