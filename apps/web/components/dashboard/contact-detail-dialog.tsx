'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/stat';
import { cn } from '@/lib/cn';
import {
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  Headphones,
  ListTodo,
  Loader2,
  MessageCircle,
  MessageSquare,
  Phone,
  PhoneCall,
  Plus,
  Send,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

/* ============================================================================
   Ficha del paciente — el expediente que unifica todo lo que la clínica sabe
   de una persona: quién es, el resumen que fue armando la IA con cada
   interacción, su próxima cita, las llamadas con su transcripción, el hilo de
   WhatsApp, las tareas abiertas y las notas internas del equipo.

   Todo cuelga de un solo contacto de GHL y se cruza por `ghl_contact_id` y
   `phone_e164`. La ficha no vuelve a pedir nada que ya viva en otro módulo:
   enlaza a él.
   ========================================================================== */

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
  hasRecording: boolean;
};

type Appointment = {
  id: string;
  startTime: string;
  endTime?: string | null;
  status: string | null;
  title: string | null;
};

type PatientTask = {
  id: string;
  title: string;
  status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  dueAt: string | null;
  completedAt: string | null;
};

type Memory = {
  summary: string | null;
  facts: Record<string, unknown>;
  lastInteractionAt: string | null;
};

type Whatsapp = {
  id: string;
  unreadCount: number;
  lastMsgAt: string | null;
  status: string | null;
};

type DetailData = {
  contact: Contact;
  calls: Call[];
  appointments: Appointment[];
  tasks: PatientTask[];
  memory: Memory | null;
  whatsapp: Whatsapp | null;
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

const PRIORITY: Record<PatientTask['priority'], { label: string; dot: string }> = {
  URGENT: { label: 'Urgente', dot: 'bg-rose-500' },
  HIGH: { label: 'Alta', dot: 'bg-amber-500' },
  MEDIUM: { label: 'Media', dot: 'bg-brand-500' },
  LOW: { label: 'Baja', dot: 'bg-zinc-300' },
};

const STATUS_LABEL: Record<PatientTask['status'], string> = {
  TODO: 'Pendiente',
  IN_PROGRESS: 'En curso',
  IN_REVIEW: 'En revisión',
  DONE: 'Hecha',
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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return 'sin actividad';
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return 'sin actividad';
  const diff = Date.now() - d;
  const day = 86_400_000;
  if (diff < 0) return `en ${Math.ceil(-diff / day)} d`;
  if (diff < 3_600_000) return 'hace un rato';
  if (diff < day) return 'hoy';
  if (diff < 2 * day) return 'ayer';
  if (diff < 30 * day) return `hace ${Math.floor(diff / day)} d`;
  return fmtDate(iso);
}

function fmtDuration(sec: number | null): string {
  if (!sec || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** `fecha_ultima_visita` → "Fecha última visita". */
function prettifyKey(k: string): string {
  const s = k.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function factToText(v: unknown): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v.filter(Boolean).map(String).join(', ') || null;
  if (typeof v === 'object') return null;
  const s = String(v).trim();
  return s || null;
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
  const [tab, setTab] = useState<'resumen' | 'llamadas' | 'citas' | 'tareas' | 'equipo' | 'datos'>(
    'resumen',
  );
  const [callingNow, setCallingNow] = useState(false);
  const [callFeedback, setCallFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/contacts/${contactId}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Error ${r.status}`);
      }
      setData((await r.json()) as DetailData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    if (!open) return;
    setTab('resumen');
    void load();
  }, [open, load]);

  const contact = data?.contact;
  const tags = (contact?.tags ?? []).filter((t) => !HIDDEN_TAGS.has(t));
  const fullName = contact
    ? [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() || 'Sin nombre'
    : 'Cargando…';

  const appts = data?.appointments ?? [];
  const nextAppointment = appts
    .filter((a) => new Date(a.startTime).getTime() > Date.now())
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];
  const upcomingCount = appts.filter((a) => new Date(a.startTime).getTime() > Date.now()).length;

  const openTasks = (data?.tasks ?? []).filter((t) => t.status !== 'DONE');

  async function callNow() {
    if (!contact?.phone) return;
    setCallingNow(true);
    setCallFeedback({ ok: true, msg: `Llamando a ${fullName}…` });
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
        setCallFeedback({
          ok: true,
          msg: 'Llamada lanzada. El paciente debería recibirla en unos segundos.',
        });
      } else {
        setCallFeedback({ ok: false, msg: body.error ?? `Error ${res.status}` });
      }
    } catch (e) {
      setCallFeedback({ ok: false, msg: e instanceof Error ? e.message : 'Error' });
    }
    setCallingNow(false);
  }

  const waHref = data?.whatsapp ? `/dashboard/whatsapp/${data.whatsapp.id}` : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[880px] gap-0 overflow-hidden p-0">
        {/* ── Cabecera-identidad ─────────────────────────────────────────── */}
        <header className="relative overflow-hidden px-5 pb-4 pt-6 sm:px-7">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(60%_120%_at_15%_0%,rgba(95,168,150,0.18),transparent_70%)]"
          />
          <div className="relative flex items-start gap-4">
            <Avatar name={fullName === 'Cargando…' ? '' : fullName} size={60} />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[22px] font-bold leading-tight tracking-tight text-zinc-900">
                {fullName}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-zinc-500">
                {contact?.phone && (
                  <span className="inline-flex items-center gap-1 font-medium tabular-nums text-zinc-600">
                    <Phone className="h-3.5 w-3.5 text-zinc-400" />
                    {contact.phone}
                  </span>
                )}
                {contact?.email && (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <span className="truncate">{contact.email}</span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  Paciente desde {fmtDate(contact?.dateAdded)}
                </span>
              </div>
              {tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tags.slice(0, 6).map((t) => (
                    <Badge key={t} tone="neutral" size="sm">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar la ficha"
              className="press inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-all duration-300 hover:rotate-90 hover:bg-zinc-100 hover:text-zinc-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* KPIs del expediente */}
          <div className="relative mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi
              icon={<Phone className="h-3.5 w-3.5" />}
              label="Llamadas"
              value={data ? String(data.calls.length) : '—'}
            />
            <Kpi
              icon={<CalendarClock className="h-3.5 w-3.5" />}
              label="Próximas citas"
              value={data ? String(upcomingCount) : '—'}
              tone={upcomingCount > 0 ? 'good' : 'muted'}
            />
            <Kpi
              icon={<ListTodo className="h-3.5 w-3.5" />}
              label="Tareas abiertas"
              value={data ? String(openTasks.length) : '—'}
              tone={openTasks.length > 0 ? 'warn' : 'muted'}
            />
            <Kpi
              icon={<Sparkles className="h-3.5 w-3.5" />}
              label="Última interacción"
              value={
                data?.memory?.lastInteractionAt ? fmtRelative(data.memory.lastInteractionAt) : '—'
              }
            />
          </div>

          {/* Acciones rápidas */}
          <div className="relative mt-4 flex flex-wrap items-center gap-2">
            {contact?.phone && (
              <Button size="sm" onClick={callNow} disabled={callingNow}>
                {callingNow ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PhoneCall className="h-3.5 w-3.5" />
                )}
                Llamar
              </Button>
            )}
            {waHref && (
              <Button asChild size="sm" variant="secondary">
                <Link href={waHref} onClick={onClose}>
                  <MessageCircle className="h-3.5 w-3.5" />
                  WhatsApp
                  {data?.whatsapp && data.whatsapp.unreadCount > 0 && (
                    <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
                      {data.whatsapp.unreadCount}
                    </span>
                  )}
                </Link>
              </Button>
            )}
            <NewTaskAction
              contactId={contactId}
              patientName={fullName}
              patientPhone={contact?.phone ?? null}
              onCreated={() => void load()}
            />
            <Button asChild size="sm" variant="ghost">
              <a
                href={`https://app.gohighlevel.com/contacts/detail/${contactId}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Ver en GHL
              </a>
            </Button>
          </div>

          {callFeedback && (
            <div
              className={cn(
                'relative mt-3 flex items-start gap-2 rounded-[12px] px-3 py-2 text-[13px]',
                callFeedback.ok
                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border border-rose-200 bg-rose-50 text-rose-800',
              )}
            >
              {callFeedback.ok && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span>{callFeedback.msg}</span>
            </div>
          )}
        </header>

        {/* ── Pestañas ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1 overflow-x-auto border-y border-[--color-border-subtle] bg-white/60 px-3 sm:px-5">
          <Tab
            active={tab === 'resumen'}
            onClick={() => setTab('resumen')}
            icon={<FileText className="h-3.5 w-3.5" />}
          >
            Resumen
          </Tab>
          <Tab
            active={tab === 'llamadas'}
            onClick={() => setTab('llamadas')}
            icon={<Phone className="h-3.5 w-3.5" />}
            count={data?.calls.length}
          >
            Llamadas
          </Tab>
          <Tab
            active={tab === 'citas'}
            onClick={() => setTab('citas')}
            icon={<Calendar className="h-3.5 w-3.5" />}
            count={appts.length}
          >
            Citas
          </Tab>
          <Tab
            active={tab === 'tareas'}
            onClick={() => setTab('tareas')}
            icon={<ListTodo className="h-3.5 w-3.5" />}
            count={openTasks.length}
          >
            Tareas
          </Tab>
          <Tab
            active={tab === 'equipo'}
            onClick={() => setTab('equipo')}
            icon={<MessageSquare className="h-3.5 w-3.5" />}
          >
            Equipo
          </Tab>
          <Tab
            active={tab === 'datos'}
            onClick={() => setTab('datos')}
            icon={<User className="h-3.5 w-3.5" />}
          >
            Datos
          </Tab>
        </div>

        {/* ── Cuerpo ─────────────────────────────────────────────────────── */}
        <div className="thread-canvas max-h-[58vh] min-h-[280px] overflow-y-auto px-5 py-5 sm:px-7">
          {loading && (
            <div className="flex items-center justify-center py-16 text-[14px] text-zinc-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Abriendo la ficha…
            </div>
          )}
          {error && !loading && (
            <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[14px] text-rose-800">
              {error}
            </div>
          )}

          {data && !loading && (
            <div className="animate-fade-up space-y-5">
              {tab === 'resumen' && (
                <ResumenTab
                  data={data}
                  nextAppointment={nextAppointment}
                  openTasks={openTasks}
                  waHref={waHref}
                  onClose={onClose}
                  onJumpTasks={() => setTab('tareas')}
                  onJumpCalls={() => setTab('llamadas')}
                />
              )}

              {tab === 'llamadas' && <CallsList calls={data.calls} onClose={onClose} />}

              {tab === 'citas' && <ApptsList appointments={appts} />}

              {tab === 'tareas' && <TasksList tasks={data.tasks} />}

              {tab === 'equipo' && (
                <div className="space-y-3">
                  <SectionTitle icon={<MessageSquare className="h-4 w-4" />}>
                    Notas internas del equipo
                  </SectionTitle>
                  <p className="text-[13px] text-zinc-500">
                    Un hilo privado sobre este paciente. No sale de la clínica y queda pegado a la
                    ficha para siempre.
                  </p>
                  <PatientTeamThread contactId={contactId} label={fullName} />
                </div>
              )}

              {tab === 'datos' && <DatosTab contact={contact} tags={tags} contactId={contactId} />}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────── Resumen ──────────────────────────────────── */

function ResumenTab({
  data,
  nextAppointment,
  openTasks,
  waHref,
  onClose,
  onJumpTasks,
  onJumpCalls,
}: {
  data: DetailData;
  nextAppointment?: Appointment;
  openTasks: PatientTask[];
  waHref: string | null;
  onClose: () => void;
  onJumpTasks: () => void;
  onJumpCalls: () => void;
}) {
  const summary = data.memory?.summary?.trim();
  const facts = Object.entries(data.memory?.facts ?? {})
    .map(([k, v]) => [k, factToText(v)] as const)
    .filter((e): e is [string, string] => !!e[1])
    .slice(0, 8);
  const recentCalls = data.calls.slice(0, 3);

  return (
    <div className="space-y-5">
      {/* Resumen con IA — la portada del expediente */}
      <section className="gradient-ring relative overflow-hidden rounded-[20px] bg-[linear-gradient(135deg,#f1faf6,#eaf6f0)] p-4 sm:p-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-[10px] bg-white/80 text-brand-700 shadow-[var(--shadow-soft)]">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-700">
            Resumen del paciente
          </span>
          {data.memory?.lastInteractionAt && (
            <span className="ml-auto text-[12px] font-medium text-brand-700/70">
              Actualizado {fmtRelative(data.memory.lastInteractionAt)}
            </span>
          )}
        </div>
        {summary ? (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-800">{summary}</p>
        ) : (
          <p className="text-[14px] leading-relaxed text-zinc-500">
            Todavía no hay resumen. Se irá armando solo a medida que el paciente hable con el
            asistente por teléfono o WhatsApp.
          </p>
        )}
        {facts.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 border-t border-brand-200/60 pt-3 sm:grid-cols-2">
            {facts.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 text-[13px]">
                <dt className="shrink-0 text-brand-700/70">{prettifyKey(k)}</dt>
                <dd className="truncate text-right font-semibold text-zinc-700">{v}</dd>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Próxima cita */}
      {nextAppointment ? (
        <section className="flex items-center gap-3 rounded-[18px] border border-emerald-200 bg-emerald-50/60 p-4">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-emerald-100 text-emerald-700">
            <CalendarClock className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-700">
              Próxima cita
            </p>
            <p className="mt-0.5 truncate text-[15px] font-semibold text-zinc-900">
              {nextAppointment.title ?? 'Cita'}
            </p>
            <p className="text-[13px] text-zinc-500">{fmtDateTime(nextAppointment.startTime)}</p>
          </div>
          {nextAppointment.status && <Badge tone="success">{nextAppointment.status}</Badge>}
        </section>
      ) : (
        <Callout
          icon={<Calendar className="h-4 w-4" />}
          title="Sin próxima cita"
          body="Este paciente no tiene ninguna cita futura agendada en GHL."
        />
      )}

      {/* Recomendaciones / próximos pasos = tareas abiertas */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle icon={<ListTodo className="h-4 w-4" />}>Próximos pasos</SectionTitle>
          {openTasks.length > 0 && (
            <button
              type="button"
              onClick={onJumpTasks}
              className="text-[12px] font-semibold text-brand-700 hover:underline"
            >
              Ver todas
            </button>
          )}
        </div>
        {openTasks.length === 0 ? (
          <p className="text-[13px] text-zinc-500">No hay tareas abiertas para este paciente.</p>
        ) : (
          <ul className="space-y-1.5">
            {openTasks.slice(0, 4).map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        )}
      </section>

      {/* WhatsApp */}
      {waHref && (
        <Link
          href={waHref}
          onClick={onClose}
          className="group flex items-center gap-3 rounded-[18px] border border-[--color-border] bg-white p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[var(--shadow-soft)]"
        >
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[linear-gradient(135deg,#e7f5ef,#ddf3ea)] text-brand-700">
            <MessageCircle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-zinc-900">Conversación de WhatsApp</p>
            <p className="text-[13px] text-zinc-500">
              {data.whatsapp?.lastMsgAt
                ? `Último mensaje ${fmtRelative(data.whatsapp.lastMsgAt)}`
                : 'Abrir el hilo del paciente'}
            </p>
          </div>
          {data.whatsapp && data.whatsapp.unreadCount > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white">
              {data.whatsapp.unreadCount}
            </span>
          )}
        </Link>
      )}

      {/* Últimas llamadas */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle icon={<Phone className="h-4 w-4" />}>Últimas llamadas</SectionTitle>
          {data.calls.length > 3 && (
            <button
              type="button"
              onClick={onJumpCalls}
              className="text-[12px] font-semibold text-brand-700 hover:underline"
            >
              Ver todas
            </button>
          )}
        </div>
        {recentCalls.length === 0 ? (
          <p className="text-[13px] text-zinc-500">Sin llamadas registradas todavía.</p>
        ) : (
          <div className="space-y-2">
            {recentCalls.map((c) => (
              <CallCard key={c.id} call={c} onClose={onClose} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ────────────────────────────── Listas ───────────────────────────────────── */

function CallsList({ calls, onClose }: { calls: Call[]; onClose: () => void }) {
  if (calls.length === 0) {
    return (
      <EmptyTab icon={<Phone className="h-6 w-6 text-zinc-300" />}>
        Sin llamadas registradas con este paciente todavía.
      </EmptyTab>
    );
  }
  return (
    <div className="space-y-2">
      {calls.map((c) => (
        <CallCard key={c.id} call={c} onClose={onClose} />
      ))}
    </div>
  );
}

function CallCard({ call, onClose }: { call: Call; onClose: () => void }) {
  const motivo = MOTIVO_LABEL[call.intent ?? ''] ?? 'Llamada';
  return (
    <Link
      href={`/dashboard/calls/${call.id}`}
      onClick={onClose}
      className="group block rounded-[16px] border border-[--color-border] bg-white p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[var(--shadow-soft)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 text-[12px] text-zinc-500">
            <span>{fmtDateTime(call.startedAt)}</span>
            <span className="text-zinc-300">·</span>
            <span className="tabular-nums">{fmtDuration(call.durationSeconds)}</span>
            {call.hasRecording && (
              <>
                <span className="text-zinc-300">·</span>
                <span className="inline-flex items-center gap-1 text-brand-600">
                  <Headphones className="h-3 w-3" />
                  grabación
                </span>
              </>
            )}
            {call.transferred && (
              <>
                <span className="text-zinc-300">·</span>
                <span className="text-amber-600">transferida</span>
              </>
            )}
          </div>
          <p className="line-clamp-2 text-[14px] text-zinc-800">
            {call.summary ?? 'Sin resumen todavía.'}
          </p>
        </div>
        <Badge tone="accent">{motivo}</Badge>
      </div>
    </Link>
  );
}

function ApptsList({ appointments }: { appointments: Appointment[] }) {
  if (appointments.length === 0) {
    return (
      <EmptyTab icon={<Calendar className="h-6 w-6 text-zinc-300" />}>
        Sin citas registradas en GHL para este paciente.
      </EmptyTab>
    );
  }
  const sorted = appointments
    .slice()
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  return (
    <div className="space-y-2">
      {sorted.map((a) => {
        const isUpcoming = new Date(a.startTime).getTime() > Date.now();
        return (
          <div
            key={a.id}
            className="flex items-start gap-3 rounded-[16px] border border-[--color-border] bg-white p-4"
          >
            <span
              className={cn(
                'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px]',
                isUpcoming ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500',
              )}
            >
              <Calendar className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-zinc-900">{a.title ?? 'Cita'}</p>
              <p className="mt-0.5 text-[13px] text-zinc-500">{fmtDateTime(a.startTime)}</p>
              {a.status && (
                <Badge tone={isUpcoming ? 'success' : 'neutral'} size="sm" className="mt-2">
                  {a.status}
                </Badge>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TasksList({ tasks }: { tasks: PatientTask[] }) {
  if (tasks.length === 0) {
    return (
      <EmptyTab icon={<ListTodo className="h-6 w-6 text-zinc-300" />}>
        Ninguna tarea vinculada a este paciente. Podés crear una desde la cabecera.
      </EmptyTab>
    );
  }
  const open = tasks.filter((t) => t.status !== 'DONE');
  const done = tasks.filter((t) => t.status === 'DONE');
  return (
    <div className="space-y-4">
      {open.length > 0 && (
        <div>
          <SectionTitle icon={<ListTodo className="h-4 w-4" />}>
            Abiertas ({open.length})
          </SectionTitle>
          <ul className="mt-2 space-y-1.5">
            {open.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        </div>
      )}
      {done.length > 0 && (
        <div>
          <SectionTitle icon={<Check className="h-4 w-4" />}>Cerradas ({done.length})</SectionTitle>
          <ul className="mt-2 space-y-1.5">
            {done.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TaskRow({ task }: { task: PatientTask }) {
  const done = task.status === 'DONE';
  const p = PRIORITY[task.priority];
  return (
    <li className="flex items-center gap-2.5 rounded-[14px] border border-[--color-border] bg-white px-3 py-2.5">
      {done ? (
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <Check className="h-3 w-3" />
        </span>
      ) : (
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', p.dot)} title={p.label} />
      )}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-[14px]',
            done ? 'text-zinc-400 line-through' : 'font-medium text-zinc-800',
          )}
        >
          {task.title}
        </span>
        <span className="text-[12px] text-zinc-400">
          {done
            ? `Cerrada ${fmtRelative(task.completedAt)}`
            : task.dueAt
              ? `Vence ${fmtDate(task.dueAt)}`
              : STATUS_LABEL[task.status]}
        </span>
      </span>
      {!done && (
        <Badge
          tone={task.priority === 'URGENT' || task.priority === 'HIGH' ? 'warn' : 'neutral'}
          size="sm"
        >
          {STATUS_LABEL[task.status]}
        </Badge>
      )}
    </li>
  );
}

function DatosTab({
  contact,
  tags,
  contactId,
}: {
  contact: Contact | undefined;
  tags: string[];
  contactId: string;
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        <Field label="Nombre" value={contact?.firstName ?? '—'} />
        <Field label="Apellido" value={contact?.lastName ?? '—'} />
        <Field label="Teléfono" value={contact?.phone ?? '—'} mono />
        <Field label="Email" value={contact?.email ?? '—'} />
        <Field label="Alta en CRM" value={fmtDateTime(contact?.dateAdded)} />
        <Field label="Última actualización" value={fmtDateTime(contact?.dateUpdated)} />
      </div>

      {tags.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-400">
            Etiquetas
          </p>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <Badge key={t} tone="neutral" size="sm">
                {t}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-[--color-border-subtle] pt-4">
        <Button asChild variant="secondary" size="sm">
          <a
            href={`https://app.gohighlevel.com/contacts/detail/${contactId}`}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Editar en GHL
          </a>
        </Button>
        <span className="text-[13px] text-zinc-500">
          Los datos personales se editan en la ficha de GHL.
        </span>
      </div>
    </div>
  );
}

/* ────────────────────────── Acción: nueva tarea ──────────────────────────── */

function NewTaskAction({
  contactId,
  patientName,
  patientPhone,
  onCreated,
}: {
  contactId: string;
  patientName: string;
  patientPhone: string | null;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const t = title.trim();
    if (!t) return;
    setState('saving');
    setError(null);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: t,
          priority: 'MEDIUM',
          category: 'PATIENT',
          patientGhlContactId: contactId,
          patientName,
          patientPhone,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          res.status === 403
            ? 'Tu rol no permite crear tareas.'
            : (body.error ?? 'No se pudo crear.'),
        );
      }
      setState('done');
      setTitle('');
      onCreated();
      setTimeout(() => {
        setOpen(false);
        setState('idle');
      }, 1000);
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : 'Error');
    }
  };

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        Tarea
      </Button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {state === 'done' ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[13px] font-semibold text-emerald-700">
          <Check className="h-3.5 w-3.5" />
          Tarea creada
        </span>
      ) : (
        <>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') setOpen(false);
            }}
            placeholder="Nueva tarea del paciente…"
            aria-label="Título de la tarea"
            autoFocus
            className="h-9 w-56"
          />
          <Button size="sm" onClick={submit} disabled={!title.trim() || state === 'saving'}>
            {state === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Crear'}
          </Button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cancelar"
            className="press inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      )}
      {error && <span className="text-[12px] text-rose-600">{error}</span>}
    </span>
  );
}

/* ────────────────────────── Piezas compartidas ───────────────────────────── */

function Kpi({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'default' | 'good' | 'warn' | 'muted';
}) {
  const valueColor =
    tone === 'good'
      ? 'text-emerald-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : tone === 'muted'
          ? 'text-zinc-400'
          : 'text-zinc-900';
  return (
    <div className="rounded-[14px] bg-white/85 px-3 py-2 ring-1 ring-[--color-border-subtle]">
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-zinc-400">
        <span className="text-brand-500">{icon}</span>
        {label}
      </span>
      <p
        className={cn(
          'mt-0.5 truncate text-[17px] font-bold tracking-tight tabular-nums',
          valueColor,
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Tab({
  active,
  onClick,
  icon,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex shrink-0 items-center gap-1.5 px-3 py-3 text-[14px] font-semibold transition-colors',
        active ? 'text-brand-700' : 'text-zinc-500 hover:text-zinc-800',
      )}
    >
      {icon}
      {children}
      {count != null && count > 0 && (
        <span
          className={cn(
            'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums',
            active ? 'bg-brand-100 text-brand-700' : 'bg-zinc-100 text-zinc-500',
          )}
        >
          {count}
        </span>
      )}
      {active && (
        <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[linear-gradient(90deg,#37766a,#6bc2a4)]" />
      )}
    </button>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="inline-flex items-center gap-2 text-[13px] font-bold tracking-tight text-zinc-800">
      <span className="text-brand-500">{icon}</span>
      {children}
    </h3>
  );
}

function Callout({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[16px] border border-[--color-border] bg-white p-4">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-zinc-100 text-zinc-400">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[14px] font-semibold text-zinc-800">{title}</p>
        <p className="text-[13px] text-zinc-500">{body}</p>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-400">
        {label}
      </p>
      <p className={cn('text-[14px] text-zinc-800', mono && 'tabular-nums')}>{value || '—'}</p>
    </div>
  );
}

function EmptyTab({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="mb-3">{icon}</div>
      <p className="max-w-xs text-[14px] text-zinc-500">{children}</p>
    </div>
  );
}

/* ─── Hilo interno del paciente (módulo Mensajes) ─────────────────────────────
   Autocontenido: abre (o crea) el canal `CONTEXT` de tipo PATIENT y monta un
   hilo mínimo. Si el módulo todavía no está disponible, muestra el aviso y el
   resto de la ficha sigue funcionando. */

type TeamMessage = {
  id: string;
  body: string;
  senderName: string | null;
  senderKind: string;
  createdAt: string;
};

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
    return <div className="skeleton h-24 rounded-[16px]" />;
  }
  if (status === 'error') {
    return (
      <div className="rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2 text-[14px] text-amber-800">
        {threadError ?? 'El chat interno no está disponible.'}
      </div>
    );
  }

  return (
    <div className="rounded-[16px] border border-[--color-border] bg-white">
      <ul className="max-h-72 space-y-3 overflow-y-auto px-3 py-3">
        {messages.map((m) => (
          <li key={m.id} className="text-[14px]">
            <p className="text-[12px] font-medium text-zinc-500">
              {m.senderKind === 'USER' ? (m.senderName ?? 'Alguien') : 'Futura'} ·{' '}
              {fmtDateTime(m.createdAt)}
            </p>
            <p className="whitespace-pre-wrap leading-snug text-zinc-700">{m.body}</p>
          </li>
        ))}
        {messages.length === 0 && (
          <li className="text-[13px] text-zinc-500">
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
      {threadError && <p className="px-3 pb-2 text-[12px] text-rose-600">{threadError}</p>}
    </div>
  );
}
