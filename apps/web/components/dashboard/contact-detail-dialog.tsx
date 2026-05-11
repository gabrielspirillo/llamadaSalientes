'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Calendar,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  User,
  X,
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
  const [tab, setTab] = useState<'datos' | 'llamadas' | 'citas'>('datos');

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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[800px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-zinc-100">
          <DialogTitle className="text-lg flex items-center gap-3">
            <User className="h-5 w-5 text-violet-600" />
            {fullName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-1 px-6 border-b border-zinc-100">
          <TabButton active={tab === 'datos'} onClick={() => setTab('datos')}>
            <User className="h-3.5 w-3.5" /> Datos
          </TabButton>
          <TabButton active={tab === 'llamadas'} onClick={() => setTab('llamadas')}>
            <Phone className="h-3.5 w-3.5" /> Llamadas
            {data && data.calls.length > 0 && (
              <span className="text-[10px] font-semibold bg-zinc-100 text-zinc-700 rounded-full px-1.5 py-0.5">
                {data.calls.length}
              </span>
            )}
          </TabButton>
          <TabButton active={tab === 'citas'} onClick={() => setTab('citas')}>
            <Calendar className="h-3.5 w-3.5" /> Citas
            {upcomingCount > 0 && (
              <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 rounded-full px-1.5 py-0.5">
                {upcomingCount}
              </span>
            )}
          </TabButton>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Cargando datos del contacto…
            </div>
          )}
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}

          {data && !loading && (
            <>
              {tab === 'datos' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
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

                  <div className="pt-2 flex items-center gap-2">
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
                          className="block rounded-lg border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 p-4 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                                <span>{fmtDateTime(c.startedAt)}</span>
                                <span>·</span>
                                <span className="tabular-nums">{fmtDuration(c.durationSeconds)}</span>
                              </div>
                              <p className="text-sm text-zinc-800 line-clamp-2">
                                {c.summary ?? 'Sin resumen aún'}
                              </p>
                            </div>
                            <Badge tone="violet">{motivo}</Badge>
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
                      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
                      .map((a) => {
                        const isUpcoming = new Date(a.startTime).getTime() > Date.now();
                        return (
                          <div
                            key={a.id}
                            className="rounded-lg border border-zinc-200 p-4 flex items-start gap-3"
                          >
                            <div
                              className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${
                                isUpcoming ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600'
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
                                <Badge
                                  tone={isUpcoming ? 'success' : 'neutral'}
                                  className="mt-2"
                                >
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
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
