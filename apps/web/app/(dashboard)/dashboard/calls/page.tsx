import { BackfillMetadataButton } from '@/components/dashboard/backfill-metadata-button';
import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/input';
import { Reveal } from '@/components/ui/motion';
import { Avatar } from '@/components/ui/stat';
import { HeadRow, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { countCallsMissingMetadata, formatDuration, listCalls } from '@/lib/data/calls-list';
import { getCurrentTenant } from '@/lib/tenant';
import { ArrowRight, Filter, Phone, PhoneCall, Search } from 'lucide-react';
import Link from 'next/link';

const motivoMap: Record<
  string,
  { label: string; tone: 'success' | 'info' | 'warn' | 'accent' | 'neutral' | 'danger' }
> = {
  agendar: { label: 'Pedir cita', tone: 'success' },
  reagendar: { label: 'Cambiar cita', tone: 'info' },
  cancelar: { label: 'Anular cita', tone: 'warn' },
  consulta: { label: 'Consulta', tone: 'accent' },
  pregunta: { label: 'Consulta', tone: 'accent' }, // legacy
  queja: { label: 'Queja', tone: 'danger' },
  otro: { label: 'Otro', tone: 'neutral' },
};

function motivoBadge(intent: string | null) {
  if (!intent) return <Badge>—</Badge>;
  const it = motivoMap[intent] ?? { label: intent, tone: 'neutral' as const };
  return <Badge tone={it.tone}>{it.label}</Badge>;
}

function statusBadge(status: string | null, transferred: boolean) {
  if (transferred) return <Badge tone="warn">Transferida</Badge>;
  if (status === 'ongoing') return <Badge tone="info">En curso</Badge>;
  if (status === 'error') return <Badge tone="danger">Error</Badge>;
  if (status === 'ended') return <Badge tone="success">Completada</Badge>;
  return <Badge>{status ?? '—'}</Badge>;
}

/** Punto de sentimiento sobre el avatar — verde/rojo/gris. */
function sentimentRing(sentiment: string | null) {
  return sentiment === 'positivo'
    ? 'bg-emerald-500'
    : sentiment === 'negativo'
      ? 'bg-rose-500'
      : 'bg-zinc-300';
}

type SearchParams = { q?: string; intent?: string; sentiment?: string };

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const { tenant } = await getCurrentTenant();
  const [realCalls, missingMetadata] = await Promise.all([
    listCalls(tenant.id, {
      limit: 100,
      q: sp.q,
      intent: sp.intent,
      sentiment: sp.sentiment,
    }),
    countCallsMissingMetadata(tenant.id),
  ]);

  const activeFilters = [sp.q, sp.intent, sp.sentiment].filter(Boolean).length;

  return (
    <>
      <PageHeader
        eyebrow="Canal entrante"
        title="Llamadas"
        description="Todas las llamadas atendidas por el agente, con transcripción, resumen y sentimiento."
        icon={<PhoneCall className="h-5 w-5" />}
        actions={<BackfillMetadataButton pending={missingMetadata} />}
      />

      <Reveal>
        <Card className="overflow-hidden">
          {/* --- Filtros ---------------------------------------------------- */}
          <form
            className="flex flex-col gap-3 border-b border-[--color-border-subtle] p-4 sm:p-5 md:flex-row md:flex-wrap md:items-center"
            action="/dashboard/calls"
          >
            <div className="relative flex-1 md:min-w-[240px]">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input
                name="q"
                defaultValue={sp.q ?? ''}
                placeholder="Buscar por número o resumen…"
                className="w-full pl-11"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 md:flex md:items-center md:gap-3">
              <Select name="intent" defaultValue={sp.intent ?? ''} className="w-full md:w-auto">
                <option value="">Todos los motivos</option>
                <option value="agendar">Pedir cita</option>
                <option value="reagendar">Cambiar cita</option>
                <option value="cancelar">Anular cita</option>
                <option value="consulta">Consulta</option>
                <option value="queja">Queja</option>
                <option value="otro">Otro</option>
              </Select>
              <Select
                name="sentiment"
                defaultValue={sp.sentiment ?? ''}
                className="w-full md:w-auto"
              >
                <option value="">Cualquier sentimiento</option>
                <option value="positivo">Positivo</option>
                <option value="neutro">Neutro</option>
                <option value="negativo">Negativo</option>
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
              <Button type="submit" variant="secondary" size="sm">
                <Filter className="h-4 w-4" /> Aplicar
              </Button>
              {activeFilters > 0 && (
                <Button asChild variant="ghost" size="sm">
                  <Link href="/dashboard/calls">Limpiar</Link>
                </Button>
              )}
              <Badge tone="brand" size="lg" className="ml-auto">
                {realCalls.length} llamadas
              </Badge>
            </div>
          </form>

          {realCalls.length === 0 ? (
            <EmptyState
              icon={<Phone className="h-5 w-5" />}
              title="Aún no hay llamadas"
              description="Cuando llegue la primera, aparecerá aquí con su transcripción, resumen y sentimiento."
              action={
                <Button asChild size="sm">
                  <Link href="/dashboard/agent">Probar el agente</Link>
                </Button>
              }
            />
          ) : (
            <>
              {/* --- Móvil: tarjetas ---------------------------------------- */}
              <ul
                className="stagger p-2 md:hidden"
                style={{ ['--stagger-step' as string]: '35ms' }}
              >
                {realCalls.map((c, i) => {
                  const phone = c.fromNumber ?? c.toNumber ?? null;
                  const customData = (c.customData ?? {}) as { patient_name?: string };
                  const patientName = customData.patient_name ?? null;
                  const display = patientName ?? phone ?? 'Sin identificar';
                  return (
                    <li key={c.id} style={{ ['--i' as string]: Math.min(i, 12) }}>
                      <Link
                        href={`/dashboard/calls/${c.id}`}
                        className="flex items-start gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-zinc-50"
                      >
                        <div className="relative shrink-0">
                          <Avatar name={display} size={38} />
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white ${sentimentRing(c.sentiment)}`}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-[15px] font-semibold text-zinc-800">
                              {display}
                            </p>
                            <span className="shrink-0 text-[12px] tabular-nums text-zinc-500">
                              {c.startedAt
                                ? new Date(c.startedAt).toLocaleString('es-ES', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : '—'}
                            </span>
                          </div>
                          {phone && patientName && (
                            <p className="mt-0.5 truncate text-xs tabular-nums text-zinc-500">
                              {phone}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {motivoBadge(c.intent)}
                            {statusBadge(c.status, c.transferred ?? false)}
                            <span className="text-[12px] tabular-nums text-zinc-500">
                              {formatDuration(c.durationSeconds)}
                            </span>
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>

              {/* --- Escritorio: tabla -------------------------------------- */}
              <div className="hidden md:block">
                <TableWrap>
                  <Table>
                    <THead>
                      <HeadRow>
                        <TH>Paciente</TH>
                        <TH className="hidden lg:table-cell">Número</TH>
                        <TH>Motivo</TH>
                        <TH>Estado</TH>
                        <TH className="hidden lg:table-cell">Duración</TH>
                        <TH>Fecha y hora</TH>
                        <TH />
                      </HeadRow>
                    </THead>
                    <tbody>
                      {realCalls.map((c) => {
                        const phone = c.fromNumber ?? c.toNumber ?? null;
                        const customData = (c.customData ?? {}) as { patient_name?: string };
                        const patientName = customData.patient_name ?? null;
                        const display =
                          patientName ??
                          (phone ? phone.slice(-4).padStart(8, '·') : 'Sin identificar');
                        return (
                          <TR key={c.id} className="group">
                            <TD>
                              <div className="flex items-center gap-3">
                                <div className="relative shrink-0">
                                  <Avatar name={display} size={32} />
                                  <span
                                    className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${sentimentRing(c.sentiment)}`}
                                  />
                                </div>
                                <span className="font-semibold text-zinc-800">{display}</span>
                              </div>
                            </TD>
                            <TD className="hidden tabular-nums text-zinc-600 lg:table-cell">
                              {phone ?? '—'}
                            </TD>
                            <TD>{motivoBadge(c.intent)}</TD>
                            <TD>{statusBadge(c.status, c.transferred ?? false)}</TD>
                            <TD className="hidden tabular-nums lg:table-cell">
                              {formatDuration(c.durationSeconds)}
                            </TD>
                            <TD className="tabular-nums text-zinc-600">
                              {(() => {
                                // started_at es lo correcto; created_at (alta de la fila
                                // por el webhook) es el fallback para llamadas viejas.
                                const when = c.startedAt ?? c.createdAt;
                                return when
                                  ? new Date(when).toLocaleString('es-ES', {
                                      day: '2-digit',
                                      month: '2-digit',
                                      year: '2-digit',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : '—';
                              })()}
                            </TD>
                            <TD className="text-right">
                              <Link
                                href={`/dashboard/calls/${c.id}`}
                                aria-label="Ver llamada"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-300 transition-all duration-300 group-hover:bg-brand-100 group-hover:text-brand-700"
                              >
                                <ArrowRight className="h-4 w-4" />
                              </Link>
                            </TD>
                          </TR>
                        );
                      })}
                    </tbody>
                  </Table>
                </TableWrap>
              </div>

              <div className="flex items-center justify-between border-t border-[--color-border-subtle] bg-[#fafbfb] p-4 text-[13px] text-zinc-500 sm:px-5">
                <span className="inline-flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5" />
                  Mostrando {realCalls.length} de {realCalls.length}
                </span>
              </div>
            </>
          )}
        </Card>
      </Reveal>
    </>
  );
}
