import { BackfillMetadataButton } from '@/components/dashboard/backfill-metadata-button';
import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { countCallsMissingMetadata, formatDuration, listCalls } from '@/lib/data/calls-list';
import { getCurrentTenant } from '@/lib/tenant';
import { ArrowRight, Download, Filter, Phone, Search } from 'lucide-react';
import Link from 'next/link';

const motivoMap: Record<string, { label: string; tone: 'success' | 'info' | 'warn' | 'violet' | 'neutral' | 'danger' }> = {
  agendar: { label: 'Agendar', tone: 'success' },
  reagendar: { label: 'Reagendar', tone: 'info' },
  cancelar: { label: 'Cancelar', tone: 'warn' },
  consulta: { label: 'Consulta', tone: 'violet' },
  pregunta: { label: 'Consulta', tone: 'violet' }, // legacy
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

function sentimentDot(sentiment: string | null) {
  const cls =
    sentiment === 'positivo'
      ? 'bg-emerald-500'
      : sentiment === 'negativo'
        ? 'bg-red-500'
        : 'bg-zinc-400';
  return <div className={`h-2 w-2 rounded-full ${cls}`} />;
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
        title="Llamadas"
        description="Todas las llamadas atendidas por el agente."
        actions={
          <div className="flex items-center gap-2">
            <BackfillMetadataButton pending={missingMetadata} />
            <Button variant="secondary" size="sm">
              <Download className="h-4 w-4" /> Exportar CSV
            </Button>
          </div>
        }
      />

      <Card>
        <form className="flex flex-col md:flex-row md:items-center md:flex-wrap gap-3 p-4 sm:p-5 border-b border-zinc-100" action="/dashboard/calls">
          <div className="relative flex-1 md:min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <Input
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="Buscar por número o resumen..."
              className="pl-9 w-full"
            />
          </div>
          <div className="grid grid-cols-2 md:flex md:items-center gap-2 md:gap-3">
            <select
              name="intent"
              defaultValue={sp.intent ?? ''}
              className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm w-full md:w-auto"
            >
              <option value="">Todos los motivos</option>
              <option value="agendar">Agendar</option>
              <option value="reagendar">Reagendar</option>
              <option value="cancelar">Cancelar</option>
              <option value="consulta">Consulta</option>
              <option value="queja">Queja</option>
              <option value="otro">Otro</option>
            </select>
            <select
              name="sentiment"
              defaultValue={sp.sentiment ?? ''}
              className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm w-full md:w-auto"
            >
              <option value="">Cualquier sentimiento</option>
              <option value="positivo">Positivo</option>
              <option value="neutro">Neutro</option>
              <option value="negativo">Negativo</option>
            </select>
          </div>
          <div className="flex items-center gap-2 flex-wrap md:flex-nowrap">
            <Button type="submit" variant="secondary" size="sm">
              <Filter className="h-4 w-4" /> Aplicar
            </Button>
            {activeFilters > 0 && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/dashboard/calls">Limpiar</Link>
              </Button>
            )}
            <div className="flex items-center gap-2 text-xs text-zinc-500 ml-auto">
              <Badge>{realCalls.length} llamadas</Badge>
            </div>
          </div>
        </form>

        {realCalls.length === 0 ? (
          <div className="px-6 py-20 text-center">
            <Phone className="mx-auto h-8 w-8 text-zinc-300 mb-3" />
            <p className="text-base font-semibold tracking-tight">Aún no hay llamadas</p>
            <p className="text-sm text-zinc-500 mt-1.5 max-w-sm mx-auto">
              Cuando llegue la primera, va a aparecer acá con su transcript, resumen y sentimiento.
            </p>
            <Button asChild size="sm" className="mt-5">
              <Link href="/dashboard/agent">Probar agente</Link>
            </Button>
          </div>
        ) : (
          <>
            {/* Mobile: card list */}
            <ul className="md:hidden divide-y divide-zinc-50">
              {realCalls.map((c) => {
                const phone = c.fromNumber ?? c.toNumber ?? null;
                const customData = (c.customData ?? {}) as { patient_name?: string };
                const patientName = customData.patient_name ?? null;
                return (
                  <li key={c.id}>
                    <Link
                      href={`/dashboard/calls/${c.id}`}
                      className="flex items-start gap-3 px-4 py-3.5 hover:bg-zinc-50/60 transition-colors"
                    >
                      <div className="mt-1.5">{sentimentDot(c.sentiment)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium truncate">
                            {patientName ?? (phone ?? 'Sin identificar')}
                          </p>
                          <span className="text-[11px] text-zinc-400 shrink-0 tabular-nums">
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
                          <p className="text-xs text-zinc-500 truncate tabular-nums mt-0.5">
                            {phone}
                          </p>
                        )}
                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                          {motivoBadge(c.intent)}
                          {statusBadge(c.status, c.transferred ?? false)}
                          <span className="text-[11px] text-zinc-500 tabular-nums">
                            {formatDuration(c.durationSeconds)}
                          </span>
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-zinc-300 shrink-0 mt-1.5" />
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* Tablet/Desktop: table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-zinc-500 border-b border-zinc-100">
                    <th className="px-5 py-3 font-medium">Paciente</th>
                    <th className="px-5 py-3 font-medium hidden lg:table-cell">Número</th>
                    <th className="px-5 py-3 font-medium">Motivo</th>
                    <th className="px-5 py-3 font-medium">Estado</th>
                    <th className="px-5 py-3 font-medium hidden lg:table-cell">Duración</th>
                    <th className="px-5 py-3 font-medium">Fecha y hora</th>
                    <th className="px-5 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {realCalls.map((c) => {
                    const phone = c.fromNumber ?? c.toNumber ?? null;
                    const customData = (c.customData ?? {}) as { patient_name?: string };
                    const patientName = customData.patient_name ?? null;
                    return (
                      <tr
                        key={c.id}
                        className="border-b border-zinc-50 last:border-b-0 hover:bg-zinc-50/60 transition-colors"
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            {sentimentDot(c.sentiment)}
                            <span className="font-medium">
                              {patientName ?? (phone ? phone.slice(-4).padStart(8, '·') : 'Sin identificar')}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-zinc-600 tabular-nums hidden lg:table-cell">
                          {phone ?? '—'}
                        </td>
                        <td className="px-5 py-3.5">{motivoBadge(c.intent)}</td>
                        <td className="px-5 py-3.5">{statusBadge(c.status, c.transferred ?? false)}</td>
                        <td className="px-5 py-3.5 text-zinc-700 tabular-nums hidden lg:table-cell">
                          {formatDuration(c.durationSeconds)}
                        </td>
                        <td className="px-5 py-3.5 text-zinc-600 tabular-nums">
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
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/dashboard/calls/${c.id}`}>
                              <ArrowRight className="h-4 w-4" />
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between p-4 sm:p-5 border-t border-zinc-100 text-sm text-zinc-500">
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5" />
                Mostrando {realCalls.length} de {realCalls.length}
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
