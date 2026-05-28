'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

type Tab = 'atributos' | 'historial' | 'notas' | 'combinar';

interface MessageItem {
  id: string;
  conversationId: string;
  direction: string;
  type: string;
  senderType: string;
  contentText: string | null;
  createdAt: string;
}
interface NoteItem {
  id: string;
  conversationId: string;
  contentText: string | null;
  createdAt: string;
}
interface CallItem {
  id: string;
  startedAt: string | null;
  durationSeconds: number | null;
  status: string | null;
  intent: string | null;
  summary: string | null;
}
interface AppointmentItem {
  id: string;
  startTime: string | null;
  endTime: string | null;
  status: string | null;
  treatment: string | null;
}
interface ConversationMeta {
  channel: string;
  status: string;
}

interface Props {
  ghlContactId: string | null;
  messages: MessageItem[];
  internalNotes: NoteItem[];
  calls: CallItem[];
  appointments: AppointmentItem[];
  conversationsById: Record<string, ConversationMeta>;
}

export function ContactHistoryTabs({
  ghlContactId,
  messages,
  internalNotes,
  calls,
  appointments,
  conversationsById,
}: Props) {
  const [tab, setTab] = useState<Tab>('historial');

  const history = useMemo(() => mergeHistory(messages, calls), [messages, calls]);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white">
      <div className="flex border-b border-zinc-100">
        {(['atributos', 'historial', 'notas', 'combinar'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-2.5 text-sm font-medium capitalize transition-colors ${
              tab === t
                ? 'border-b-2 border-emerald-500 text-emerald-700'
                : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {t === 'atributos'
              ? 'Atributos'
              : t === 'historial'
                ? 'Historial'
                : t === 'notas'
                  ? 'Notas'
                  : 'Combinar'}
          </button>
        ))}
      </div>

      <div className="p-4">
        {tab === 'atributos' && <Atributos ghlContactId={ghlContactId} appointments={appointments} />}
        {tab === 'historial' && (
          <Historial history={history} conversationsById={conversationsById} />
        )}
        {tab === 'notas' && (
          <Notas notes={internalNotes} conversationsById={conversationsById} />
        )}
        {tab === 'combinar' && (
          <p className="text-sm text-zinc-500">
            Próximamente: combinar este contacto con otro existente.
          </p>
        )}
      </div>
    </div>
  );
}

function Atributos({
  ghlContactId,
  appointments,
}: {
  ghlContactId: string | null;
  appointments: AppointmentItem[];
}) {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold uppercase text-zinc-500">CRM_LINK</span>
          {ghlContactId ? (
            <span className="font-mono text-[10px] text-zinc-600">{ghlContactId.slice(0, 12)}…</span>
          ) : (
            <span className="text-zinc-400">Sin enlace</span>
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-500">Citas</h3>
        {appointments.length === 0 ? (
          <p className="text-sm text-zinc-500">No hay citas registradas.</p>
        ) : (
          <ul className="space-y-2">
            {appointments.map((a) => (
              <li
                key={a.id}
                className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-zinc-900">
                    {a.treatment ?? 'Cita'}
                  </span>
                  {a.status && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${appointmentStatusClass(a.status)}`}
                    >
                      {a.status}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {a.startTime ? new Date(a.startTime).toLocaleString() : 'Sin fecha'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type HistoryEntry =
  | {
      kind: 'message';
      id: string;
      conversationId: string;
      direction: string;
      senderType: string;
      contentText: string | null;
      timestamp: string;
    }
  | {
      kind: 'call';
      id: string;
      timestamp: string | null;
      durationSeconds: number | null;
      status: string | null;
      intent: string | null;
      summary: string | null;
    };

function mergeHistory(messages: MessageItem[], calls: CallItem[]): HistoryEntry[] {
  const all: HistoryEntry[] = [
    ...messages.map<HistoryEntry>((m) => ({
      kind: 'message',
      id: m.id,
      conversationId: m.conversationId,
      direction: m.direction,
      senderType: m.senderType,
      contentText: m.contentText,
      timestamp: m.createdAt,
    })),
    ...calls.map<HistoryEntry>((c) => ({
      kind: 'call',
      id: c.id,
      timestamp: c.startedAt,
      durationSeconds: c.durationSeconds,
      status: c.status,
      intent: c.intent,
      summary: c.summary,
    })),
  ];
  return all.sort((a, b) => {
    const ta = a.timestamp ?? '';
    const tb = b.timestamp ?? '';
    return tb.localeCompare(ta);
  });
}

function Historial({
  history,
  conversationsById,
}: {
  history: HistoryEntry[];
  conversationsById: Record<string, ConversationMeta>;
}) {
  if (history.length === 0) {
    return <p className="text-sm text-zinc-500">Sin actividad registrada.</p>;
  }
  return (
    <ul className="space-y-3">
      {history.map((h) =>
        h.kind === 'message' ? (
          <MessageRow
            key={`m-${h.id}`}
            entry={h}
            channel={conversationsById[h.conversationId]?.channel}
          />
        ) : (
          <CallRow key={`c-${h.id}`} entry={h} />
        ),
      )}
    </ul>
  );
}

function MessageRow({
  entry,
  channel,
}: {
  entry: Extract<HistoryEntry, { kind: 'message' }>;
  channel?: string;
}) {
  const isOutbound = entry.direction === 'OUTBOUND';
  return (
    <li>
      <Link
        href={`/dashboard/whatsapp/${entry.conversationId}`}
        className="flex items-start gap-2 rounded-lg p-2 hover:bg-zinc-50"
      >
        <div
          className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${isOutbound ? 'bg-emerald-500' : 'bg-blue-500'}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between text-[11px] text-zinc-500">
            <span className="uppercase">
              {channel ? channelShort(channel) : 'WhatsApp'} ·{' '}
              {isOutbound ? (entry.senderType === 'AGENT' ? 'Agente' : 'Operador') : 'Contacto'}
            </span>
            <span>{formatShort(entry.timestamp)}</span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm text-zinc-700">
            {entry.contentText ?? <em className="text-zinc-400">(adjunto sin texto)</em>}
          </p>
        </div>
      </Link>
    </li>
  );
}

function CallRow({ entry }: { entry: Extract<HistoryEntry, { kind: 'call' }> }) {
  return (
    <li>
      <Link
        href={`/dashboard/llamadas/${entry.id}`}
        className="flex items-start gap-2 rounded-lg p-2 hover:bg-zinc-50"
      >
        <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-purple-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between text-[11px] text-zinc-500">
            <span className="uppercase">
              Llamada
              {entry.durationSeconds != null && ` · ${formatDuration(entry.durationSeconds)}`}
              {entry.intent && ` · ${entry.intent}`}
            </span>
            <span>{entry.timestamp ? formatShort(entry.timestamp) : ''}</span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm text-zinc-700">
            {entry.summary ?? <em className="text-zinc-400">(sin resumen)</em>}
          </p>
        </div>
      </Link>
    </li>
  );
}

function Notas({
  notes,
  conversationsById: _conversationsById,
}: {
  notes: NoteItem[];
  conversationsById: Record<string, ConversationMeta>;
}) {
  if (notes.length === 0) {
    return <p className="text-sm text-zinc-500">Sin notas internas.</p>;
  }
  return (
    <ul className="space-y-2">
      {notes.map((n) => (
        <li
          key={n.id}
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm"
        >
          <p className="whitespace-pre-wrap text-zinc-800">{n.contentText}</p>
          <Link
            href={`/dashboard/whatsapp/${n.conversationId}`}
            className="mt-1 inline-block text-[10px] uppercase text-amber-700 hover:text-amber-900"
          >
            {formatShort(n.createdAt)} · Ver conversación
          </Link>
        </li>
      ))}
    </ul>
  );
}

function appointmentStatusClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('confirm')) return 'bg-emerald-100 text-emerald-700';
  if (s.includes('show') && !s.includes('no')) return 'bg-blue-100 text-blue-700';
  if (s.includes('no')) return 'bg-red-100 text-red-700';
  if (s.includes('cancel')) return 'bg-zinc-200 text-zinc-700';
  return 'bg-zinc-100 text-zinc-700';
}

function channelShort(c: string): string {
  if (c === 'WHATSAPP_CLOUD') return 'CLOUD';
  if (c === 'WHATSAPP_EVOLUTION') return 'EVOLUTION';
  if (c === 'WHATSAPP_TWILIO') return 'TWILIO';
  return c;
}

function formatShort(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString();
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}
