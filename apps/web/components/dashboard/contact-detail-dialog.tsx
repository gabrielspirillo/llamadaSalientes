'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Calendar,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  PhoneCall,
  Send,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type Contact = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  tags?: string[] | null;
  dateAdded?: string | null;
  dateUpdated?: string | null;
};

type Call = {
  id: string;
  retellCallId: string;
  fromNumber: string | null;
  toNumber: string | null;
  startedAt: string | null;
  durationSeconds: number | null;
  intent: string | null;
  sentiment: string | null;
  summary: string | null;
  transferred: boolean | null;
};

type Appointment = {
  id: string;
  startTime: string;
  endTime?: string | null;
  status: string | null;
  title: string | null;
};

type DetailData = {
  contact: Contact;
  calls: Call[];
  appointments: Appointment[];
};

const HIDDEN_TAGS = new Set(['seed-dentalflow', 'sin-tratamiento-activo', 'con-seguro']);

const MOTIVO_LABEL: Record<string, string> = {
  agendar: 'Agendar',
  reagendar: 'Reagendar',
  cancelar: 'Cancelar',
  consulta: 'Consulta',
  pregunta: 'Consulta',
  queja: 'Queja',
  otro: 'Otro',
};

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDuration(sec: number | null): string {
  if (!sec || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ContactDetailDialog({
  contactId,
  open,
  onClose,
}: {
  contactId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'datos' | 'llamadas' | 'citas' | 'equipo'>('datos');
  const [callingNow, setCallingNow] = useState(false);
  const [callFeedback, setCallFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    setLoading(true);
    setError(null);
    fetch(`/api/contacts/${contactId}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `Error ${r.status}`);
        }
        return (await r.json()) as DetailData;
      })
      .then((d) => {
        if (mounted) setData(d);
      })
      .catch((e) => {
        if (mounted) setError(e instanceof Error ? e.message : 'Error');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [contactId, open]);

  const contact = data?.contact;
  const tags = (contact?.tags ?? []).filter((t) => !HIDDEN_TAGS.has(t));
  const fullName = contact
    ? [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() || 'Sin nombre'
    : 'Cargando…';

  const upcomingCount = (data?.appointments ?? []).filter(
    (a) => new Date(a.startTime).getTime() > Date.now(),
  ).length;

  async function callNow() {
    if (!contact?.phone) return;
    setCallingNow(true);
    setCallFeedback({ ok: true, msg: `Disparando llamada a ${fullName}…` });
    try {
      const res = await fetch('/api/calls/outbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toNumber: contact.phone,
          patientName: fullName,
          ghlContactId: contact.id,
          email: contact.email ?? null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        callId?: string;
        status?: string;
        error?: string;
      };
      if (res.ok) {
        const callId = body.callId ?? '';
        setCallFeedback({
          ok: true,
          msg: `Llamada disparada (${body.status ?? 'registered'}). Call ID: ${callId.slice(-12)}. Si el paciente no recibe la llamada en 10 segundos, revisá Retell logs.`,
        });
      } else {
        setCallFeedback({
          ok: false,
          msg: body.error ?? `Error ${res.status}`,
        });
      }
    } catch (e) {
      setCallFeedback({
        ok: false,
        msg: e instanceof Error ? e.message : 'Error',
      });
    }
    setCallingNow(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[800px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 sm:px-6 pt-5 pb-4 border-b border-[--color-border-subtle]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <DialogTitle className="text-lg flex items-center gap-3 min-w-0">
              <User className="h-5 w-5 text-brand-600 shrink-0" />
              <span className="truncate">{fullName}</span>
            </DialogTitle>
            {contact?.phone && (
              <Button
                size="sm"
                onClick={callNow}
                disabled={callingNow}
                className="self-start sm:self-auto"
              >
                {callingNow ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PhoneCall className="h-3.5 w-3.5" />
                )}
                Llamar ahora
              </Button>
            )}
          </div>
          {callFeedback && (
            <div
              className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                callFeedback.ok
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border border-rose-200 text-rose-800'
              }`}
            >
              {callFeedback.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" /> : null}
              <span>{callFeedback.msg}</span>
            </div>
          )}
        </DialogHeader>

        <div className="flex items-center gap-1 px-4 sm:px-6 border-b border-[--color-border-subtle] overflow-x-auto">
          <TabButton active={tab === 'datos'} onClick={() => setTab('datos')}>
            <User className="h-3.5 w-3.5" /> Datos
          </TabButton>
          <TabButton active={tab === 'llamadas'} onClick={() => setTab('llamadas')}>
            <Phone className="h-3.5 w-3.5" /> Llamadas
            {data && data.calls.length > 0 && (
              <span className="text-[12px] font-semibold bg-zinc-100 text-zinc-700 rounded-full px-1.5 py-0.5">
                {data.calls.length}
              </span>
            )}
          </TabButton>
          <TabButton active={tab === 'citas'} onClick={() => setTab('citas')}>
            <Calendar className="h-3.5 w-3.5" /> Citas
            {upcomingCount > 0 && (
              <span className="text-[12px] font-semibold bg-emerald-100 text-emerald-700 rounded-full px-1.5 py-0.5">
                {upcomingCount}
              </span>
            )}
          </TabButton>
          <TabButton active={tab === 'equipo'} onClick={() => setTab('equipo')}>
            <MessageSquare className="h-3.5 w-3.5" /> Equipo
          </TabButton>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-4 sm:px-6 py-5">
          {loading && (
            <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Cargando datos del contacto…
            </div>
          )}
          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-800">
              {error}
            </div>
          )}

          {data && !loading && (
            <>
              {tab === 'datos' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <ReadOnlyField label="Nombre" value={contact?.firstName ?? '—'} />
                    <ReadOnlyField label="Apellido" value={contact?.lastName ?? '—'} />
                    <ReadOnlyField label="Teléfono" value={contact?.phone ?? '—'} mono />
                    <ReadOnlyField label="Email" value={contact?.email ?? '—'} />
                    <ReadOnlyField label="Alta en CRM" value={fmtDateTime(contact?.dateAdded)} />
                    <ReadOnlyField
                      label="Última actualización"
                      value={fmtDateTime(contact?.dateUpdated)}
                    />
                  </div>

                  {tags.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-zinc-500 mb-2 uppercase tracking-wider">
                        Tags
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {tags.map((t) => (
                          <span
                            key={t}
                            className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-2 flex flex-wrap items-center gap-2">
                    <Button asChild variant="secondary" size="sm">
                      <a
                        href={`https://app.gohighlevel.com/contacts/detail/${contactId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> Editar en GHL
                      </a>
                    </Button>
                    <span className="text-xs text-zinc-500">
                      Para editar datos personales, abrí la ficha en GHL.
                    </span>
                  </div>
                </div>
              )}

              {tab === 'llamadas' && (
                <div className="space-y-2">
                  {data.calls.length === 0 ? (
                    <EmptyTab icon={<Phone className="h-6 w-6 text-zinc-300" />}>
                      Sin llamadas registradas con este contacto todavía.
                    </EmptyTab>
                  ) : (
                    data.calls.map((c) => {
                      const motivo = MOTIVO_LABEL[c.intent ?? ''] ?? '—';
                      return (
                        <Link
                          key={c.id}
                          href={`/dashboard/calls/${c.id}`}
                          onClick={onClose}
                          className="block rounded-lg border border-[--color-border] hover:border-brand-200 hover:bg-zinc-50 p-4 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                                <span>{fmtDateTime(c.startedAt)}</span>
                                <span>·</span>
                                <span className="tabular-nums">
                                  {fmtDuration(c.durationSeconds)}
                                </span>
                              </div>
                              <p className="text-sm text-zinc-800 line-clamp-2">
                                {c.summary ?? 'Sin resumen aún'}
                              </p>
                            </div>
                            <Badge tone="accent">{motivo}</Badge>
                          </div>
                        </Link>
                      );
                    })
                  )}
                </div>
              )}

              {tab === 'citas' && (
                <div className="space-y-2">
                  {data.appointments.length === 0 ? (
                    <EmptyTab icon={<Calendar className="h-6 w-6 text-zinc-300" />}>
                      Sin citas registradas en GHL para este contacto.
                    </EmptyTab>
                  ) : (
                    data.appointments
                      .slice()
                      .sort(
                        (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
                      )
                      .map((a) => {
                        const isUpcoming = new Date(a.startTime).getTime() > Date.now();
                        return (
                          <div
                            key={a.id}
                            className="rounded-lg border border-[--color-border] p-4 flex items-start gap-3"
                          >
                            <div
                              className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${
                                isUpcoming
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-zinc-100 text-zinc-600'
                              }`}
                            >
                              <Calendar className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm">{a.title ?? 'Cita'}</p>
                              <p className="text-xs text-zinc-500 mt-0.5">
                                {fmtDateTime(a.startTime)}
                                {a.endTime ? ` – ${fmtDateTime(a.endTime).split(' ').pop()}` : ''}
                              </p>
                              {a.status && (
                                <Badge tone={isUpcoming ? 'success' : 'neutral'} className="mt-2">
                                  {a.status}
                                </Badge>
                              )}
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              )}

              {tab === 'equipo' && (
                <div className="space-y-3">
                  <p className="text-xs text-zinc-500">
                    Hilo interno sobre este paciente. No lo ve nadie fuera de la clínica y queda
                    junto a la ficha para siempre.
                  </p>
                  <PatientTeamThread contactId={contactId} label={fullName} />
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Hilo interno del paciente (módulo Mensajes) ─────────────────────────────
// Autocontenido: abre (o crea) el canal `CONTEXT` de tipo PATIENT y monta un
// hilo mínimo. Si el módulo todavía no está disponible, muestra el aviso y el
// resto de la ficha sigue funcionando.

type TeamMessage = {
  id: string;
  body: string;
  senderName: string | null;
  senderKind: string;
  createdAt: string;
};

/** Carga la página del hilo. Fuera del componente: no depende de su estado. */
async function fetchTeamThread(id: string): Promise<TeamMessage[]> {
  const res = await fetch(`/api/messages/channels/${id}/messages`, { cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as {
    messages?: TeamMessage[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? 'No se pudo cargar el hilo');
  return data.messages ?? [];
}

function PatientTeamThread({ contactId, label }: { contactId: string; label: string }) {
  const [channelId, setChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setStatus('loading');
      try {
        const res = await fetch('/api/messages/channels/context', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contextType: 'PATIENT',
            contextId: contactId,
            label: label.slice(0, 160),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
        if (!res.ok || !data.id) throw new Error(data.error ?? 'No se pudo abrir el hilo');
        if (!alive) return;
        setChannelId(data.id);
        const list = await fetchTeamThread(data.id);
        if (!alive) return;
        setMessages(list);
        setStatus('ready');
      } catch (e) {
        if (!alive) return;
        setThreadError(e instanceof Error ? e.message : 'Error');
        setStatus('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [contactId, label]);

  async function send() {
    const body = draft.trim();
    if (!body || !channelId) return;
    setDraft('');
    setSending(true);
    try {
      const res = await fetch(`/api/messages/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body, clientNonce: `${Date.now()}-${Math.random()}` }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'No se pudo enviar');
      }
      setMessages(await fetchTeamThread(channelId));
      setThreadError(null);
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSending(false);
    }
  }

  if (status === 'loading') {
    return <div className="h-24 rounded-xl bg-zinc-100 animate-pulse" />;
  }
  if (status === 'error') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        {threadError ?? 'El chat interno no está disponible.'}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[--color-border] bg-white">
      <ul className="max-h-72 space-y-3 overflow-y-auto px-3 py-3">
        {messages.map((m) => (
          <li key={m.id} className="text-sm">
            <p className="text-[13px] font-medium text-zinc-400">
              {m.senderKind === 'USER' ? (m.senderName ?? 'Alguien') : 'Cliniq'} ·{' '}
              {fmtDateTime(m.createdAt)}
            </p>
            <p className="whitespace-pre-wrap leading-snug text-zinc-700">{m.body}</p>
          </li>
        ))}
        {messages.length === 0 && (
          <li className="text-xs text-zinc-400">
            Todavía no hay notas del equipo sobre esta persona.
          </li>
        )}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-center gap-2 border-t border-[--color-border-subtle] px-3 py-2"
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Nota interna para el equipo…"
          className="flex-1"
        />
        <Button type="submit" size="sm" disabled={sending}>
          {sending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Enviar
        </Button>
      </form>
      {threadError && <p className="px-3 pb-2 text-[13px] text-rose-600">{threadError}</p>}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
        active ? 'text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'
      }`}
    >
      {children}
      {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-900" />}
    </button>
  );
}

function ReadOnlyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-sm text-zinc-800 ${mono ? 'tabular-nums' : ''}`}>{value || '—'}</p>
    </div>
  );
}

function EmptyTab({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-3">{icon}</div>
      <p className="text-sm text-zinc-500 max-w-xs">{children}</p>
    </div>
  );
}
