import { AudioPlayer } from '@/components/dashboard/audio-player';
import { Badge } from '@/components/ui/badge';
import { Card, CardTopbar } from '@/components/ui/card';
import { Reveal } from '@/components/ui/motion';
import { Avatar } from '@/components/ui/stat';
import { formatDuration, getCall, getCallTranscript } from '@/lib/data/calls-list';
import { getCurrentTenant } from '@/lib/tenant';
import {
  ArrowLeft,
  Calendar,
  Clock,
  ExternalLink,
  FileText,
  Info,
  Phone,
  Sparkles,
  User,
  Volume2,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

const INTENT_META: Record<
  string,
  { label: string; tone: 'success' | 'info' | 'warn' | 'violet' | 'neutral' | 'danger' }
> = {
  agendar: { label: 'Pedir cita', tone: 'success' },
  reagendar: { label: 'Cambiar cita', tone: 'info' },
  cancelar: { label: 'Anular cita', tone: 'warn' },
  consulta: { label: 'Consulta', tone: 'violet' },
  pregunta: { label: 'Consulta', tone: 'violet' },
  queja: { label: 'Queja', tone: 'danger' },
  otro: { label: 'Otro', tone: 'neutral' },
};

function intentBadge(intent: string | null) {
  if (!intent) return <Badge>—</Badge>;
  const it = INTENT_META[intent] ?? { label: intent, tone: 'neutral' as const };
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

  // started_at es lo correcto; created_at (alta de la fila por el webhook) es el
  // fallback para llamadas viejas a las que les falta el timestamp.
  const occurredAt = call.startedAt ?? call.createdAt;
  const startedDate = occurredAt
    ? new Date(occurredAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
    : '—';

  const customData = (call.customData ?? {}) as { patient_name?: string };
  const title = customData.patient_name ?? call.fromNumber ?? call.toNumber ?? 'Llamada anónima';

  return (
    <>
      <Link
        href="/dashboard/calls"
        className="group mb-6 inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3.5 py-1.5 text-[16px] font-semibold text-zinc-500 ring-1 ring-[--color-border] transition-all duration-300 hover:text-brand-700 hover:ring-brand-200"
      >
        <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-1" />
        Volver a llamadas
      </Link>

      <div className="mb-6 flex animate-fade-down flex-col justify-between gap-4 sm:mb-8 md:flex-row md:items-center">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={title} size={54} className="hidden shrink-0 sm:inline-flex" />
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2 sm:gap-3">
              <h1 className="truncate text-[31px] font-extrabold tracking-tight text-zinc-900 sm:text-[38px]">
                {title}
              </h1>
              {statusBadge(call.status, call.transferred ?? false)}
              {intentBadge(call.intent)}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[16px] text-zinc-500 sm:gap-x-5">
              <span className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" /> {call.fromNumber ?? '—'}
              </span>
              <span className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" /> → {call.toNumber ?? '—'}
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
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6">
        <div className="xl:col-span-2 space-y-4 sm:space-y-6">
          {/* Audio player */}
          <Reveal>
            <Card>
              <CardTopbar
                icon={<Volume2 className="h-4 w-4" />}
                tone="grape"
                title="Grabación"
                subtitle="Audio completo de la llamada"
                action={call.recordingR2Key ? <Badge tone="success">Almacenada</Badge> : undefined}
              />
              <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                <AudioPlayer callId={call.id} />
              </div>
            </Card>
          </Reveal>

          {/* Transcript */}
          <Reveal delay={90}>
            <Card>
              <CardTopbar
                icon={<FileText className="h-4 w-4" />}
                tone="sky"
                title="Transcripción"
                subtitle="Diálogo completo entre el agente y el paciente"
                action={transcript ? <Badge tone="info">cifrada · AES-256</Badge> : undefined}
              />
              <div className="border-t border-[--color-border-subtle] px-4 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-5 max-h-[60vh] sm:max-h-[480px] overflow-y-auto">
                {transcriptTurns.length === 0 ? (
                  <div className="text-center py-8 text-sm text-zinc-500">
                    La transcripción aparecerá en cuanto termine de procesarse la llamada.
                  </div>
                ) : (
                  transcriptTurns.map((turn, i) => {
                    const turnId = `tr-${i}`;
                    return (
                      <div key={turnId} className="flex gap-2 sm:gap-3">
                        <div className="hidden sm:block text-xs text-zinc-400 tabular-nums pt-1.5 w-12 shrink-0">
                          {turn.t}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium mb-1 text-zinc-500">
                            {turn.speaker === 'agent' ? 'Agente' : 'Paciente'}
                          </div>
                          <p
                            className={`break-words rounded-2xl px-4 py-2.5 text-[16px] leading-relaxed ${
                              turn.speaker === 'agent'
                                ? 'rounded-tl-md bg-[#f4f7f6] text-brand-900'
                                : 'rounded-tl-md bg-[#e9f4fe] text-sky-900'
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
          </Reveal>
        </div>

        <div className="space-y-4 sm:space-y-6">
          {/* AI summary — siempre en español, traduce on-demand si vino en inglés */}
          <Reveal direction="right">
            <Card>
              <CardTopbar
                icon={<Sparkles className="h-4 w-4" />}
                tone="blossom"
                title="Resumen IA"
                subtitle="Generado tras la llamada"
              />
              <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                {call.summary ? (
                  <p className="text-[16px] leading-relaxed text-zinc-700">
                    {await ensureSpanish(call.summary)}
                  </p>
                ) : (
                  <p className="text-[16px] text-zinc-500">
                    El resumen se genera solo en cuanto termina de procesarse la llamada.
                  </p>
                )}
                <div className="mt-5 grid grid-cols-2 gap-2.5">
                  <div className="rounded-2xl bg-[#f4f7f6] p-3">
                    <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-400">
                      Sentimiento
                    </p>
                    <p className="mt-1 text-[17px] font-bold capitalize text-brand-800">
                      {call.sentiment ?? '—'}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[#fdf0f7] p-3">
                    <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-emerald-400">
                      Motivo
                    </p>
                    <p className="mt-1 text-[17px] font-bold text-emerald-800">
                      {call.intent ? (INTENT_META[call.intent]?.label ?? call.intent) : '—'}
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          </Reveal>

          {/* GHL contact link */}
          {call.ghlContactId && (
            <Reveal direction="right" delay={80}>
              <Card>
                <CardTopbar
                  icon={<User className="h-4 w-4" />}
                  tone="mint"
                  title="Contacto en GoHighLevel"
                  subtitle="Historial completo del paciente"
                />
                <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                  <GhlContactLink contactId={call.ghlContactId} tenantId={tenant.id} />
                </div>
              </Card>
            </Reveal>
          )}

          {/* Metadata */}
          <Reveal direction="right" delay={150}>
            <Card>
              <CardTopbar icon={<Info className="h-4 w-4" />} tone="zinc" title="Datos técnicos" />
              <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                <div className="space-y-2.5 text-[16px]">
                  <FieldRow label="Retell Call ID" value={call.retellCallId} mono />
                  <FieldRow label="GHL Contact" value={call.ghlContactId ?? '—'} mono />
                  <FieldRow
                    label="Inicio"
                    value={call.startedAt ? new Date(call.startedAt).toLocaleString('es-ES') : '—'}
                  />
                  <FieldRow
                    label="Fin"
                    value={call.endedAt ? new Date(call.endedAt).toLocaleString('es-ES') : '—'}
                  />
                </div>
              </div>
            </Card>
          </Reveal>
        </div>
      </div>
    </>
  );
}

async function ensureSpanish(text: string): Promise<string> {
  // Heurística rápida: si tiene tilde / ñ / palabras españolas frecuentes → ya está
  if (/[áéíóúñ¿¡]|paciente|cita|llamó|consulta|agendar/i.test(text)) return text;
  if (!process.env.GEMINI_API_KEY) return text;
  try {
    const { translateToSpanish } = await import('@/lib/gemini/client');
    return await translateToSpanish(text);
  } catch {
    return text;
  }
}

function GhlContactLink({
  contactId,
  tenantId: _tenantId,
}: { contactId: string; tenantId: string }) {
  // GHL deep-link: /v2/location/{locationId}/contacts/detail/{contactId}
  // Como el locationId no está en client, usamos el contact short URL que GHL acepta.
  const url = `https://app.gohighlevel.com/contacts/detail/${contactId}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-[16px] font-semibold text-emerald-700 transition-all duration-300 hover:-translate-y-0.5 hover:bg-emerald-100"
    >
      Abrir ficha en GoHighLevel
      <ExternalLink className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
    </a>
  );
}

/**
 * Retell guarda transcript como texto plano (concatenación de turnos).
 * Si el formato es JSON estructurado, lo parseamos. Si es texto, lo mostramos como un solo turno.
 */
function parseTranscript(
  raw: string | null,
): { speaker: 'agent' | 'user'; text: string; t: string }[] {
  if (!raw) return [];

  // JSON estructurado: [{ role: 'agent'|'user', content: '...' }, ...]
  try {
    const parsed = JSON.parse(raw) as Array<{
      role?: string;
      speaker?: string;
      content?: string;
      text?: string;
    }>;
    if (Array.isArray(parsed)) {
      return parsed.map((p, i) => ({
        speaker: p.role === 'agent' || p.speaker === 'agent' ? 'agent' : 'user',
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
