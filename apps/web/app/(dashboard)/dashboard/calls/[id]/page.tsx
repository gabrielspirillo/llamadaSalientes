import { AudioPlayer } from '@/components/dashboard/audio-player';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { formatDuration, getCall, getCallTranscript } from '@/lib/data/calls-list';
import { getCurrentTenant } from '@/lib/tenant';
import { ArrowLeft, Calendar, Clock, Phone, Sparkles, User, Volume2 } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

function intentBadge(intent: string | null) {
  if (!intent) return <Badge>—</Badge>;
  const map: Record<string, { label: string; tone: 'success' | 'info' | 'warn' | 'violet' | 'neutral' | 'danger' }> = {
    agendar: { label: 'Agendar', tone: 'success' },
    reagendar: { label: 'Reagendar', tone: 'info' },
    cancelar: { label: 'Cancelar', tone: 'warn' },
    pregunta: { label: 'Pregunta', tone: 'violet' },
    queja: { label: 'Queja', tone: 'danger' },
    otro: { label: 'Otro', tone: 'neutral' },
  };
  const it = map[intent] ?? { label: intent, tone: 'neutral' as const };
  return <Badge tone={it.tone}>{it.label}</Badge>;
}

function statusBadge(status: string | null, transferred: boolean) {
  if (transferred) return <Badge tone="warn">Transferida</Badge>;
  if (status === 'ongoing') return <Badge tone="info">En curso</Badge>;
  if (status === 'error') return <Badge tone="danger">Error</Badge>;
  return <Badge tone="success">Completada</Badge>;
}

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenant } = await getCurrentTenant();
  const call = await getCall(tenant.id, id);
  if (!call) notFound();

  const transcript = await getCallTranscript(tenant.id, id);
  const transcriptTurns = parseTranscript(transcript);

  const startedDate = call.startedAt
    ? new Date(call.startedAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
    : '—';

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
            <h1 className="text-3xl font-semibold tracking-tight">
              {call.fromNumber ?? 'Llamada anónima'}
            </h1>
            {statusBadge(call.status, call.transferred ?? false)}
            {intentBadge(call.intent)}
          </div>
          <div className="flex flex-wrap items-center gap-5 text-sm text-zinc-500">
            <span className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" /> {call.fromNumber ?? '—'}
            </span>
            <span className="flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" /> →{' '}
              {call.toNumber ?? '—'}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> {formatDuration(call.durationSeconds)}
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> {startedDate}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          {/* Audio player */}
          <Card>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold tracking-tight inline-flex items-center gap-2">
                  <Volume2 className="h-4 w-4 text-zinc-400" />
                  Grabación
                </h3>
                {call.recordingR2Key && <Badge tone="success">en R2</Badge>}
              </div>
              <AudioPlayer callId={call.id} />
            </div>
          </Card>

          {/* Transcript */}
          <Card>
            <div className="flex items-center justify-between p-6 pb-4">
              <h3 className="text-base font-semibold tracking-tight">Transcripción</h3>
              {transcript && <Badge>cifrada · AES-256</Badge>}
            </div>
            <div className="border-t border-zinc-100 px-6 py-5 space-y-5 max-h-[480px] overflow-y-auto">
              {transcriptTurns.length === 0 ? (
                <div className="text-center py-8 text-sm text-zinc-500">
                  La transcripción aparecerá cuando termine el procesamiento.
                </div>
              ) : (
                transcriptTurns.map((turn, i) => {
                  const turnId = `tr-${i}`;
                  return (
                    <div key={turnId} className="flex gap-3">
                      <div className="text-xs text-zinc-400 tabular-nums pt-1.5 w-12 shrink-0">
                        {turn.t}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium mb-1 text-zinc-500">
                          {turn.speaker === 'agent' ? 'Agente' : 'Paciente'}
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
                })
              )}
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
              {call.summary ? (
                <p className="text-sm text-zinc-700 leading-relaxed">{call.summary}</p>
              ) : (
                <p className="text-sm text-zinc-500">
                  El resumen se genera automáticamente cuando termine el procesamiento.
                </p>
              )}
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-zinc-500">Sentimiento</p>
                  <p className="font-medium capitalize mt-0.5">{call.sentiment ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Intención</p>
                  <p className="font-medium capitalize mt-0.5">{call.intent ?? '—'}</p>
                </div>
              </div>
            </div>
          </Card>

          {/* Metadata */}
          <Card>
            <div className="p-6">
              <h3 className="text-base font-semibold tracking-tight mb-4">Metadata</h3>
              <div className="space-y-2.5 text-sm">
                <FieldRow label="Retell Call ID" value={call.retellCallId} mono />
                <FieldRow label="GHL Contact" value={call.ghlContactId ?? '—'} />
                <FieldRow
                  label="Inicio"
                  value={
                    call.startedAt
                      ? new Date(call.startedAt).toLocaleString('es-ES')
                      : '—'
                  }
                />
                <FieldRow
                  label="Fin"
                  value={
                    call.endedAt ? new Date(call.endedAt).toLocaleString('es-ES') : '—'
                  }
                />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * Retell guarda transcript como texto plano (concatenación de turnos).
 * Si el formato es JSON estructurado, lo parseamos. Si es texto, lo mostramos como un solo turno.
 */
function parseTranscript(raw: string | null): { speaker: 'agent' | 'user'; text: string; t: string }[] {
  if (!raw) return [];

  // JSON estructurado: [{ role: 'agent'|'user', content: '...' }, ...]
  try {
    const parsed = JSON.parse(raw) as Array<{ role?: string; speaker?: string; content?: string; text?: string }>;
    if (Array.isArray(parsed)) {
      return parsed.map((p, i) => ({
        speaker: (p.role === 'agent' || p.speaker === 'agent') ? 'agent' : 'user',
        text: p.content ?? p.text ?? '',
        t: `${i.toString().padStart(2, '0')}`,
      }));
    }
  } catch {
    // No es JSON, fallback
  }

  // Formato Retell típico: "Agent: Hola\nUser: Hola que tal\n..."
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  return lines.map((line, i) => {
    const isAgent = /^(agent|sofía|manuel|asistente)/i.test(line);
    const text = line.replace(/^[^:]+:\s*/, '');
    return {
      speaker: isAgent ? ('agent' as const) : ('user' as const),
      text,
      t: `${i.toString().padStart(2, '0')}`,
    };
  });
}

function FieldRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-500 shrink-0">{label}</span>
      <span
        className={`font-medium text-right truncate min-w-0 ${mono ? 'font-mono text-xs' : ''}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
