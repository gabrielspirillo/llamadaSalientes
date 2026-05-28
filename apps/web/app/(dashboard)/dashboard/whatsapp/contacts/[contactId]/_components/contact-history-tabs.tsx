'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';

import {
  addContactNote,
  deleteContactNote,
  mergeContacts,
  searchContactsForMerge,
} from '../../actions';

type Tab = 'atributos' | 'historial' | 'notas' | 'combinar';

interface ConversationEntry {
  id: string;
  channel: string;
  status: string;
  lastMsgAt: string | null;
  lastMessagePreview: string | null;
  lastMessageDirection: string | null;
  lastMessageSenderType: string | null;
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

interface NoteItem {
  id: string;
  body: string;
  authorEmail: string | null;
  createdAt: string;
}

interface Props {
  contactId: string;
  ghlContactId: string | null;
  conversations: ConversationEntry[];
  calls: CallItem[];
  appointments: AppointmentItem[];
  notes: NoteItem[];
}

export function ContactHistoryTabs({
  contactId,
  ghlContactId,
  conversations,
  calls,
  appointments,
  notes,
}: Props) {
  const [tab, setTab] = useState<Tab>('atributos');

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
            {t}
          </button>
        ))}
      </div>

      <div className="p-4">
        {tab === 'atributos' && (
          <Atributos ghlContactId={ghlContactId} appointments={appointments} />
        )}
        {tab === 'historial' && <Historial conversations={conversations} calls={calls} />}
        {tab === 'notas' && <Notas contactId={contactId} notes={notes} />}
        {tab === 'combinar' && <Combinar contactId={contactId} />}
      </div>
    </div>
  );
}

// ─── Atributos ────────────────────────────────────────────────────────────

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
                  <span className="font-medium text-zinc-900">{a.treatment ?? 'Cita'}</span>
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

// ─── Historial (una línea por conversación + llamadas) ────────────────────

function Historial({
  conversations,
  calls,
}: {
  conversations: ConversationEntry[];
  calls: CallItem[];
}) {
  const empty = conversations.length === 0 && calls.length === 0;
  if (empty) return <p className="text-sm text-zinc-500">Sin actividad registrada.</p>;

  return (
    <div className="space-y-4">
      {conversations.length > 0 && (
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Conversaciones
          </h3>
          <ul className="space-y-1">
            {conversations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/dashboard/whatsapp/${c.id}`}
                  className="flex items-start gap-2 rounded-lg p-2 hover:bg-zinc-50"
                >
                  <div
                    className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                      c.lastMessageDirection === 'OUTBOUND' ? 'bg-emerald-500' : 'bg-blue-500'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <span className="uppercase">
                        {channelShort(c.channel)} ·{' '}
                        {c.lastMessageDirection === 'OUTBOUND'
                          ? c.lastMessageSenderType === 'AGENT'
                            ? 'Agente'
                            : 'Operador'
                          : 'Contacto'}
                      </span>
                      <span>{c.lastMsgAt ? formatShort(c.lastMsgAt) : ''}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-sm text-zinc-700">
                      {c.lastMessagePreview ?? <em className="text-zinc-400">(sin mensajes)</em>}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {calls.length > 0 && (
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Llamadas
          </h3>
          <ul className="space-y-1">
            {calls.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/dashboard/llamadas/${c.id}`}
                  className="flex items-start gap-2 rounded-lg p-2 hover:bg-zinc-50"
                >
                  <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-purple-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <span className="uppercase">
                        Llamada
                        {c.durationSeconds != null && ` · ${formatDuration(c.durationSeconds)}`}
                        {c.intent && ` · ${c.intent}`}
                      </span>
                      <span>{c.startedAt ? formatShort(c.startedAt) : ''}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-sm text-zinc-700">
                      {c.summary ?? <em className="text-zinc-400">(sin resumen)</em>}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Notas ────────────────────────────────────────────────────────────────

function Notas({ contactId, notes }: { contactId: string; notes: NoteItem[] }) {
  const [body, setBody] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAdd() {
    const trimmed = body.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const res = await addContactNote({ contactId, body: trimmed });
      if (res.success) {
        setBody('');
      } else {
        setError(res.error);
      }
    });
  }

  function handleDelete(noteId: string) {
    startTransition(async () => {
      await deleteContactNote({ id: noteId, contactId });
    });
  }

  function applyWrap(left: string, right: string = left) {
    const ta = document.getElementById('contact-note-textarea') as HTMLTextAreaElement | null;
    if (!ta) {
      setBody((prev) => prev + left + right);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = body.slice(start, end);
    const next = body.slice(0, start) + left + selected + right + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      const cursor = start + left.length + selected.length;
      ta.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-zinc-50 p-3">
        <div className="mb-2 flex items-center gap-1 border-b border-zinc-200 pb-2">
          <ToolbarButton onClick={() => applyWrap('**')} title="Negrita">
            <span className="font-bold">B</span>
          </ToolbarButton>
          <ToolbarButton onClick={() => applyWrap('_')} title="Itálica">
            <span className="italic">I</span>
          </ToolbarButton>
          <ToolbarButton onClick={() => applyWrap('[', '](https://)')} title="Link">
            🔗
          </ToolbarButton>
          <div className="mx-1 h-4 w-px bg-zinc-300" />
          <ToolbarButton
            onClick={() => setBody((p) => (p ? `${p}\n- ` : '- '))}
            title="Lista"
          >
            •
          </ToolbarButton>
          <ToolbarButton
            onClick={() => setBody((p) => (p ? `${p}\n1. ` : '1. '))}
            title="Lista numerada"
          >
            1.
          </ToolbarButton>
          <ToolbarButton onClick={() => applyWrap('`')} title="Código">
            {'</>'}
          </ToolbarButton>
        </div>
        <textarea
          id="contact-note-textarea"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Añadir nota"
          rows={4}
          className="w-full resize-none bg-transparent text-sm focus:outline-none"
          disabled={pending}
        />
        <div className="mt-2 flex items-center justify-between">
          {error ? (
            <span className="text-xs text-red-700">{error}</span>
          ) : (
            <span className="text-[10px] text-zinc-400">Markdown soportado</span>
          )}
          <button
            type="button"
            onClick={handleAdd}
            disabled={pending || body.trim().length === 0}
            className="text-sm font-medium text-emerald-600 hover:text-emerald-700 disabled:text-zinc-400"
          >
            {pending ? 'Guardando…' : 'Guardar nota'}
          </button>
        </div>
      </div>

      {notes.length === 0 ? (
        <p className="text-center text-sm text-zinc-500">
          No hay notas asociadas a este contacto. Puede añadir una nota escribiendo en el recuadro
          superior.
        </p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li
              key={n.id}
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between text-[10px] uppercase text-amber-700">
                <span>{n.authorEmail ?? 'Anónimo'}</span>
                <div className="flex items-center gap-2">
                  <span>{formatShort(n.createdAt)}</span>
                  <button
                    type="button"
                    onClick={() => handleDelete(n.id)}
                    disabled={pending}
                    className="text-amber-700 hover:text-red-700 disabled:text-amber-300"
                    aria-label="Eliminar nota"
                  >
                    ×
                  </button>
                </div>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-zinc-800">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ToolbarButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded text-xs text-zinc-600 hover:bg-zinc-200"
    >
      {children}
    </button>
  );
}

// ─── Combinar ─────────────────────────────────────────────────────────────

interface SearchResult {
  id: string;
  name: string | null;
  phoneE164: string;
  ghlContactId: string | null;
}

function Combinar({ contactId }: { contactId: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    void (async () => {
      const res = await searchContactsForMerge({ query: q, excludeId: contactId });
      if (cancelled) return;
      setSearching(false);
      if (res.success) setResults(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [query, contactId]);

  function handleMerge() {
    if (!selected) return;
    setError(null);
    const confirmed = window.confirm(
      `¿Combinar este contacto con "${selected.name ?? selected.phoneE164}"? El contacto seleccionado se borrará y todas sus conversaciones, notas y citas pasarán al actual.`,
    );
    if (!confirmed) return;
    startTransition(async () => {
      const res = await mergeContacts({ targetId: contactId, sourceId: selected.id });
      if (res.success) {
        setSelected(null);
        setQuery('');
        setResults([]);
        window.location.reload();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Buscá el contacto duplicado a combinar. Sus conversaciones, notas y citas pasarán al
        contacto actual y luego será eliminado.
      </p>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(null);
        }}
        placeholder="Buscar por nombre o teléfono…"
        className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-400 focus:outline-none"
      />
      {searching && <p className="text-[11px] text-zinc-400">Buscando…</p>}
      {!searching && query.trim().length >= 2 && results.length === 0 && (
        <p className="text-[11px] text-zinc-400">Sin resultados.</p>
      )}
      <ul className="space-y-1">
        {results.map((r) => {
          const isSelected = selected?.id === r.id;
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelected(r)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  isSelected
                    ? 'border border-emerald-300 bg-emerald-50'
                    : 'border border-transparent hover:bg-zinc-50'
                }`}
              >
                <div className="font-medium text-zinc-900">{r.name ?? '(sin nombre)'}</div>
                <div className="text-xs text-zinc-500">{r.phoneE164}</div>
                {r.ghlContactId && (
                  <div className="mt-0.5 text-[10px] text-zinc-400">
                    GHL · {r.ghlContactId.slice(0, 12)}…
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {selected && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-800">
            Vas a mergear <strong>{selected.name ?? selected.phoneE164}</strong> en este contacto.
            Esta acción no se puede deshacer.
          </p>
          {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
          <button
            type="button"
            onClick={handleMerge}
            disabled={pending}
            className="mt-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? 'Combinando…' : 'Combinar contactos'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

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
