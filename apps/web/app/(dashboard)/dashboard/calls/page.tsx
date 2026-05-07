import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { mockCalls } from '@/lib/mock-data';
import { ArrowRight, Download, Filter, Phone, Search } from 'lucide-react';
import Link from 'next/link';

const intentMap = {
  book: { label: 'Agendar', tone: 'success' as const },
  reschedule: { label: 'Reagendar', tone: 'info' as const },
  cancel: { label: 'Cancelar', tone: 'warn' as const },
  pricing: { label: 'Precios', tone: 'violet' as const },
  faq: { label: 'FAQ', tone: 'neutral' as const },
  human: { label: 'Humano', tone: 'danger' as const },
  other: { label: 'Otro', tone: 'neutral' as const },
};

const statusMap = {
  completed: { label: 'Completada', tone: 'success' as const },
  transferred: { label: 'Transferida', tone: 'warn' as const },
  missed: { label: 'Perdida', tone: 'danger' as const },
};

export default function CallsPage() {
  return (
    <>
      <PageHeader
        title="Llamadas"
        description="Todas las llamadas atendidas por el agente."
        demoBadge
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
        {/* Filters bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-5 border-b border-zinc-100">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <Input placeholder="Buscar por paciente o número..." className="pl-9" />
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="hidden md:inline">Mostrando</span>
            <Badge>{mockCalls.length} llamadas</Badge>
            <span>·</span>
            <span>Hoy</span>
          </div>
        </div>

        {/* Table */}
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
              {mockCalls.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-zinc-50 last:border-b-0 hover:bg-zinc-50/60 transition-colors"
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-2 w-2 rounded-full ${
                          c.sentiment === 'positive'
                            ? 'bg-emerald-500'
                            : c.sentiment === 'negative'
                              ? 'bg-red-500'
                              : 'bg-zinc-400'
                        }`}
                      />
                      <span className="font-medium">{c.patientName}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-zinc-600 tabular-nums">{c.fromNumber}</td>
                  <td className="px-5 py-3.5">
                    <Badge tone={intentMap[c.intent].tone}>{intentMap[c.intent].label}</Badge>
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge tone={statusMap[c.status].tone}>{statusMap[c.status].label}</Badge>
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

        {/* Pagination footer mock */}
        <div className="flex items-center justify-between p-5 border-t border-zinc-100 text-sm text-zinc-500">
          <div className="flex items-center gap-2">
            <Phone className="h-3.5 w-3.5" />
            Mostrando 1–{mockCalls.length} de 247
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled>
              Anterior
            </Button>
            <Button variant="secondary" size="sm">
              Siguiente
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}
