'use client';

import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ReminderDetailDialog } from './ReminderDetailDialog';
import { SkipList } from './SkipList';

type ReminderStatus =
  | 'SCHEDULED'
  | 'SENT'
  | 'DELIVERED'
  | 'CONFIRMED'
  | 'RESCHEDULE_REQUESTED'
  | 'CANCELLED'
  | 'NO_RESPONSE'
  | 'SKIPPED'
  | 'FAILED';

export type Reminder = {
  id: string;
  ghlAppointmentId: string;
  ruleId: string;
  scheduledFor: Date | string;
  channelPlanned: 'WHATSAPP' | 'VOICE';
  channelUsed: 'WHATSAPP' | 'VOICE' | null;
  status: ReminderStatus;
  sentAt: Date | string | null;
  respondedAt: Date | string | null;
  failureReason: string | null;
  payloadSnapshot: unknown;
};

export type Rule = { label: string | null; offsetMinutes: number };

export type SkipRow = {
  id: string;
  ghlAppointmentId: string;
  ruleId: string | null;
  reason: string;
  details: unknown;
  createdAt: Date | string;
  appointmentStart?: Date | string | null;
  treatmentName?: string | null;
};

const COLUMNS: {
  status: ReminderStatus;
  title: string;
  tone: 'neutral' | 'success' | 'warn' | 'danger' | 'info';
}[] = [
  { status: 'SCHEDULED', title: 'Programado', tone: 'info' },
  { status: 'SENT', title: 'Enviado', tone: 'neutral' },
  { status: 'CONFIRMED', title: 'Confirmado', tone: 'success' },
  { status: 'RESCHEDULE_REQUESTED', title: 'Pidió reagendar', tone: 'warn' },
  { status: 'CANCELLED', title: 'Cancelado', tone: 'danger' },
  { status: 'NO_RESPONSE', title: 'Sin respuesta', tone: 'warn' },
];

function offsetToHuman(minutes: number): string {
  if (minutes % (60 * 24) === 0) return `${minutes / 60 / 24}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function fmtDateShort(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function extractContactName(snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== 'object') return 'Paciente';
  const v = (snapshot as { vars?: { contact?: { fullName?: string; firstName?: string } } }).vars;
  return v?.contact?.fullName || v?.contact?.firstName || 'Paciente';
}

function extractAppointmentParts(snapshot: unknown): {
  treatment: string;
  date: string;
  time: string;
  dateTime: string;
} {
  if (!snapshot || typeof snapshot !== 'object')
    return { treatment: '', date: '', time: '', dateTime: '' };
  const v = (
    snapshot as {
      vars?: {
        appointment?: { treatment?: string; date?: string; time?: string; dateTime?: string };
      };
    }
  ).vars;
  return {
    treatment: v?.appointment?.treatment ?? '',
    date: v?.appointment?.date ?? '',
    time: v?.appointment?.time ?? '',
    dateTime: v?.appointment?.dateTime ?? '',
  };
}

// ─── Componente principal ────────────────────────────────────────────────────

export function RemindersPipeline({
  initialReminders,
  initialRulesById,
  initialSkipped,
}: {
  initialReminders: Reminder[];
  initialRulesById: Record<string, Rule>;
  initialSkipped: SkipRow[];
}) {
  const [reminders, setReminders] = useState<Reminder[]>(initialReminders);
  const [rulesById, setRulesById] = useState<Record<string, Rule>>(initialRulesById);
  const [skipped, setSkipped] = useState<SkipRow[]>(initialSkipped);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Polling cada 15s para refrescar la lista sin recargar la página. Si la
  // pestaña está en background no pollea (visibilityState).
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/reminders?include=skipped', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        const nextRules: Record<string, Rule> = {};
        for (const r of data.reminders ?? []) {
          if (r.rule) nextRules[r.ruleId] = r.rule;
        }
        setReminders(data.reminders ?? []);
        setRulesById(nextRules);
        setSkipped(data.skipped ?? []);
        setLastRefresh(new Date());
      } catch (err) {
        console.warn('[reminders-pipeline] poll failed', err);
      }
    }
    const interval = window.setInterval(refresh, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return reminders;
    const q = search.toLowerCase();
    return reminders.filter((r) => {
      const name = extractContactName(r.payloadSnapshot).toLowerCase();
      const appt = extractAppointmentParts(r.payloadSnapshot);
      return (
        name.includes(q) ||
        appt.treatment.toLowerCase().includes(q) ||
        appt.dateTime.toLowerCase().includes(q) ||
        r.ghlAppointmentId.toLowerCase().includes(q)
      );
    });
  }, [reminders, search]);

  const byStatus = useMemo(() => {
    const map = new Map<ReminderStatus, Reminder[]>();
    for (const col of COLUMNS) map.set(col.status, []);
    for (const r of filtered) {
      map.get(r.status)?.push(r);
    }
    return map;
  }, [filtered]);

  const selected = selectedId ? reminders.find((r) => r.id === selectedId) ?? null : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Buscar paciente, tratamiento o cita…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm placeholder:text-zinc-400 focus:border-zinc-300 focus:outline-none"
        />
        <span className="text-xs text-zinc-500">{filtered.length} reminders</span>
        <span className="ml-auto text-[11px] text-zinc-400">
          Actualizado{' '}
          {new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(
            lastRefresh,
          )}
          {' · '}auto cada 15s
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {COLUMNS.map((col) => {
          const items = byStatus.get(col.status) ?? [];
          return (
            <div key={col.status} className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-medium text-zinc-700">{col.title}</span>
                <Badge tone={col.tone}>{items.length}</Badge>
              </div>
              {/* max-h ~ 4 cards visibles (cada card ~108px + gap 8px = ~480px).
                  Scroll vertical interno por columna. */}
              <div className="flex flex-col gap-2 overflow-y-auto pr-1" style={{ maxHeight: 480 }}>
                {items.length === 0 ? (
                  <div className="rounded-md border border-dashed border-zinc-200 p-3 text-center text-xs text-zinc-400">
                    Vacío
                  </div>
                ) : (
                  items.map((r) => (
                    <ReminderCard
                      key={r.id}
                      reminder={r}
                      rule={rulesById[r.ruleId] ?? null}
                      onClick={() => setSelectedId(r.id)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">Omitidos ({skipped.length})</h2>
        <SkipList skipped={skipped} />
      </div>

      {selected && (
        <ReminderDetailDialog
          reminder={selected}
          rule={rulesById[selected.ruleId] ?? null}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

// ─── Card individual ─────────────────────────────────────────────────────────

function ReminderCard({
  reminder,
  rule,
  onClick,
}: {
  reminder: Reminder;
  rule: Rule | null;
  onClick: () => void;
}) {
  const name = extractContactName(reminder.payloadSnapshot);
  const appt = extractAppointmentParts(reminder.payloadSnapshot);
  return (
    <Card
      onClick={onClick}
      className="cursor-pointer p-3 hover:shadow-md hover:border-zinc-300 transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-zinc-800 truncate">{name}</span>
        <Badge tone={reminder.channelPlanned === 'VOICE' ? 'warn' : 'info'}>
          {reminder.channelPlanned === 'VOICE' ? 'Voz' : 'WA'}
        </Badge>
      </div>
      {appt.treatment && (
        <p className="mt-1 text-xs text-zinc-600 truncate">{appt.treatment}</p>
      )}
      {appt.dateTime && (
        <p className="mt-0.5 text-[11px] text-zinc-500 truncate">{appt.dateTime}</p>
      )}
      <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-400">
        <span>Envío: {fmtDateShort(reminder.scheduledFor)}</span>
        {rule && <span>{rule.label ?? `−${offsetToHuman(rule.offsetMinutes)}`}</span>}
      </div>
      {reminder.failureReason && (
        <p className="mt-1 truncate text-[11px] text-rose-500" title={reminder.failureReason}>
          ⚠ {reminder.failureReason}
        </p>
      )}
    </Card>
  );
}
