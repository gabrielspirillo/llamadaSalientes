import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { type CallRow, formatDuration, formatRelativeTime, listCalls } from '@/lib/data/calls-list';
import { mockCalls } from '@/lib/mock-data';
import { getCurrentTenantOrNull } from '@/lib/tenant';
import { ArrowRight, Download, Filter, Phone, Search } from 'lucide-react';
import Link from 'next/link';

const intentMap: Record<string, { label: string; tone: 'success' | 'info' | 'warn' | 'violet' | 'neutral' | 'danger' }> = {
  agendar: { label: 'Agendar', tone: 'success' },
  reagendar: { label: 'Reagendar', tone: 'info' },
  cancelar: { label: 'Cancelar', tone: 'warn' },
  pregunta: { label: 'Pregunta', tone: 'violet' },
  queja: { label: 'Queja', tone: 'danger' },
  otro: { label: 'Otro', tone: 'neutral' },
  // Compat con mocks
  book: { label: 'Agendar', tone: 'success' },
  reschedule: { label: 'Reagendar', tone: 'info' },
  cancel: { label: 'Cancelar', tone: 'warn' },
  pricing: { label: 'Precios', tone: 'violet' },
  faq: { label: 'FAQ', tone: 'neutral' },
  human: { label: 'Humano', tone: 'danger' },
  other: { label: 'Otro', tone: 'neutral' },
};

function intentBadge(intent: string | null) {
  if (!intent) return <Badge>—</Badge>;
  const it = intentMap[intent] ?? { label: intent, tone: 'neutral' as const };
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
    sentiment === 'positivo' || sentiment === 'positive'
      ? 'bg-emerald-500'
      : sentiment === 'negativo' || sentiment === 'negative'
        ? 'bg-red-500'
        : 'bg-zinc-400';
  return <div className={`h-2 w-2 rounded-full ${cls}`} />;
}

export default async function CallsPage() {
  const tenantCtx = await getCurrentTenantOrNull();
  const realCalls: CallRow[] = tenantCtx ? await listCalls(tenantCtx.tenant.id, 50) : [];
  const useReal = realCalls.length > 0;

  return (
    <>
      <PageHeader
        title="Llamadas"
        description="Todas las llamadas atendidas por el agente."
        demoBadge={!useReal}
        actions={
          <>
            <Button variant="secondary" size="sm">
              <Filter className="h-4 w-4" /> Filtrar
            </Button>
            <Button variant="secondary" size="sm">
              <Download className="h-4 w-4" /> Exportar CSV
            </Button>
          </>
        }
      />

      <Card>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-5 border-b border-zinc-100">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <Input placeholder="Buscar por paciente o número..." className="pl-9" />
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="hidden md:inline">Mostrando</span>
            <Badge>{useReal ? realCalls.length : mockCalls.length} llamadas</Badge>
            {!useReal && <span className="text-amber-600">demo</span>}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-zinc-500 border-b border-zinc-100">
                <th className="px-5 py-3 font-medium">Paciente</th>
                <th className="px-5 py-3 font-medium">Número</th>
                <th className="px-5 py-3 font-medium">Intent</th>
                <th className="px-5 py-3 font-medium">Estado</th>
                <th className="px-5 py-3 font-medium">Duración</th>
                <th className="px-5 py-3 font-medium">Cuándo</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {useReal
                ? realCalls.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-zinc-50 last:border-b-0 hover:bg-zinc-50/60 transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          {sentimentDot(c.sentiment)}
                          <span className="font-medium">
                            {c.fromNumber ?? 'Desconocido'}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-zinc-600 tabular-nums">
                        {c.fromNumber ?? '—'}
                      </td>
                      <td className="px-5 py-3.5">{intentBadge(c.intent)}</td>
                      <td className="px-5 py-3.5">{statusBadge(c.status, c.transferred ?? false)}</td>
                      <td className="px-5 py-3.5 text-zinc-700 tabular-nums">
                        {formatDuration(c.durationSeconds)}
                      </td>
                      <td className="px-5 py-3.5 text-zinc-500">
                        {formatRelativeTime(c.startedAt)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/dashboard/calls/${c.id}`}>
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))
                : mockCalls.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-zinc-50 last:border-b-0 hover:bg-zinc-50/60 transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          {sentimentDot(c.sentiment)}
                          <span className="font-medium">{c.patientName}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-zinc-600 tabular-nums">{c.fromNumber}</td>
                      <td className="px-5 py-3.5">{intentBadge(c.intent)}</td>
                      <td className="px-5 py-3.5">
                        <Badge tone={c.status === 'completed' ? 'success' : c.status === 'transferred' ? 'warn' : 'danger'}>
                          {c.status === 'completed' ? 'Completada' : c.status === 'transferred' ? 'Transferida' : 'Perdida'}
                        </Badge>
                      </td>
                      <td className="px-5 py-3.5 text-zinc-700 tabular-nums">{c.duration}</td>
                      <td className="px-5 py-3.5 text-zinc-500">{c.startedAt}</td>
                      <td className="px-5 py-3.5 text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/dashboard/calls/${c.id}`}>
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between p-5 border-t border-zinc-100 text-sm text-zinc-500">
          <div className="flex items-center gap-2">
            <Phone className="h-3.5 w-3.5" />
            {useReal
              ? `Mostrando 1–${realCalls.length} de ${realCalls.length}`
              : `Mostrando 1–${mockCalls.length} de 247 (demo)`}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled>
              Anterior
            </Button>
            <Button variant="secondary" size="sm" disabled={useReal && realCalls.length < 50}>
              Siguiente
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}
