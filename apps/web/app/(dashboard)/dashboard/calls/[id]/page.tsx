import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { mockCalls, mockTranscript } from '@/lib/mock-data';
import {
  ArrowLeft,
  Calendar,
  Clock,
  ExternalLink,
  Pause,
  Play,
  Sparkles,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const call = mockCalls.find((c) => c.id === id);
  if (!call) notFound();

  return (
    <>
      <Link
        href="/dashboard/calls"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Volver a llamadas
      </Link>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-semibold tracking-tight">{call.patientName}</h1>
            <Badge tone="success">
              {call.status === 'completed' ? 'Completada' : 'Transferida'}
            </Badge>
          </div>
          <div className="flex items-center gap-5 text-sm text-zinc-500">
            <span className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" /> {call.fromNumber}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> {call.duration}
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> {call.startedAt}
            </span>
          </div>
        </div>
        <Button variant="secondary" size="sm">
          <ExternalLink className="h-4 w-4" /> Ver en GHL
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          {/* Audio player */}
          <Card>
            <div className="p-6">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  className="h-12 w-12 inline-flex items-center justify-center rounded-full bg-black text-white hover:bg-zinc-800 transition-colors active:scale-95"
                >
                  <Play className="h-5 w-5 ml-0.5" />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-2 text-xs tabular-nums text-zinc-500">
                    <span>0:34</span>
                    <span>{call.duration}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                    <div className="h-full w-1/4 rounded-full bg-zinc-900" />
                  </div>
                  <div className="mt-3 flex items-center gap-1 h-7">
                    {Array.from({ length: 60 }).map((_, i) => {
                      const id = `wf-${i}`;
                      const h = 30 + Math.abs(Math.sin(i * 0.6) * 50) + (i % 7) * 3;
                      return (
                        <div
                          key={id}
                          className={`flex-1 rounded-full ${i < 15 ? 'bg-zinc-900' : 'bg-zinc-200'}`}
                          style={{ height: `${Math.min(h, 95)}%` }}
                        />
                      );
                    })}
                  </div>
                </div>
                <Button variant="ghost" size="icon">
                  <Pause className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>

          {/* Transcript */}
          <Card>
            <div className="flex items-center justify-between p-6 pb-4">
              <h3 className="text-base font-semibold tracking-tight">Transcripción</h3>
              <Badge>cifrada · AES-256</Badge>
            </div>
            <div className="border-t border-zinc-100 px-6 py-5 space-y-5 max-h-[480px] overflow-y-auto">
              {mockTranscript.map((turn, i) => {
                const id = `tr-${i}-${turn.t}`;
                return (
                  <div key={id} className="flex gap-3">
                    <div className="text-xs text-zinc-400 tabular-nums pt-1.5 w-10 shrink-0">
                      {turn.t}
                    </div>
                    <div className="flex-1">
                      <div className="text-xs font-medium mb-1 text-zinc-500">
                        {turn.speaker === 'agent' ? 'Sofía (agente)' : call.patientName}
                      </div>
                      <p
                        className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                          turn.speaker === 'agent'
                            ? 'bg-zinc-100 text-zinc-800'
                            : 'bg-blue-50 text-blue-900'
                        }`}
                      >
                        {turn.text}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          {/* AI summary */}
          <Card>
            <div className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-violet-600" />
                <h3 className="text-base font-semibold tracking-tight">Resumen IA</h3>
              </div>
              <p className="text-sm text-zinc-700 leading-relaxed">{call.summary}</p>
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-zinc-500">Sentiment</p>
                  <p className="font-medium capitalize mt-0.5">{call.sentiment}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Intent</p>
                  <p className="font-medium capitalize mt-0.5">{call.intent}</p>
                </div>
              </div>
            </div>
          </Card>

          {/* Actions executed */}
          <Card>
            <div className="p-6">
              <h3 className="text-base font-semibold tracking-tight mb-4">Acciones ejecutadas</h3>
              <div className="space-y-3">
                <ToolCall name="lookup_patient" status="ok" detail="Encontrado en GHL" />
                <ToolCall name="check_availability" status="ok" detail="3 slots devueltos" />
                <ToolCall
                  name="book_appointment"
                  status="ok"
                  detail="Cita creada · viernes 10:00"
                />
                <ToolCall name="end_call" status="ok" />
              </div>
            </div>
          </Card>

          {/* Custom fields */}
          <Card>
            <div className="p-6">
              <h3 className="text-base font-semibold tracking-tight mb-4">Custom fields GHL</h3>
              <div className="space-y-2.5 text-sm">
                <FieldRow label="Última llamada" value="hace 12 min" />
                <FieldRow label="Resumen" value="Limpieza viernes 10:00" />
                <FieldRow label="Voice agent priority" value="Medio" />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function ToolCall({
  name,
  status,
  detail,
}: {
  name: string;
  status: 'ok' | 'error';
  detail?: string;
}) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <div
        className={`h-2 w-2 rounded-full mt-1.5 ${status === 'ok' ? 'bg-emerald-500' : 'bg-red-500'}`}
      />
      <div className="flex-1 min-w-0">
        <p className="font-medium font-mono text-xs">{name}()</p>
        {detail && <p className="text-xs text-zinc-500 mt-0.5">{detail}</p>}
      </div>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium text-right truncate max-w-[60%]">{value}</span>
    </div>
  );
}
