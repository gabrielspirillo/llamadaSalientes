'use client';

import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

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

type Reminder = {
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

type Rule = { label: string | null; offsetMinutes: number };

const COLUMNS: { status: ReminderStatus; title: string; tone: 'neutral' | 'success' | 'warn' | 'danger' | 'info' }[] = [
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

function fmtDate(d: Date | string | null): string {
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

function extractAppointmentLine(snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const v = (snapshot as { vars?: { appointment?: { treatment?: string; dateTime?: string } } }).vars;
  const treatment = v?.appointment?.treatment ?? '';
  const dt = v?.appointment?.dateTime ?? '';
  return [treatment, dt].filter(Boolean).join(' · ');
}

export function RemindersPipeline({
  reminders,
  rulesById,
}: {
  reminders: Reminder[];
  rulesById: Record<string, Rule>;
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return reminders;
    const q = search.toLowerCase();
    return reminders.filter((r) => {
      const name = extractContactName(r.payloadSnapshot).toLowerCase();
      const appt = extractAppointmentLine(r.payloadSnapshot).toLowerCase();
      return name.includes(q) || appt.includes(q) || r.ghlAppointmentId.toLowerCase().includes(q);
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

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <input
          type="text"
          placeholder="Buscar paciente, tratamiento o cita…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm placeholder:text-zinc-400 focus:border-zinc-300 focus:outline-none"
        />
        <span className="text-xs text-zinc-500">{filtered.length} reminders</span>
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
              <div className="flex flex-col gap-2">
                {items.length === 0 ? (
                  <div className="rounded-md border border-dashed border-zinc-200 p-3 text-center text-xs text-zinc-400">
                    Vacío
                  </div>
                ) : (
                  items.map((r) => {
                    const rule = rulesById[r.ruleId];
                    return (
                      <Card key={r.id} className="p-3 hover:shadow-sm transition-shadow">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium text-zinc-800 truncate">
                            {extractContactName(r.payloadSnapshot)}
                          </span>
                          <Badge tone={r.channelPlanned === 'VOICE' ? 'warn' : 'info'}>
                            {r.channelPlanned === 'VOICE' ? 'Voz' : 'WA'}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-zinc-500 truncate">
                          {extractAppointmentLine(r.payloadSnapshot) || '—'}
                        </p>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-400">
                          <span>{fmtDate(r.scheduledFor)}</span>
                          {rule && (
                            <span>
                              {rule.label ?? `−${offsetToHuman(rule.offsetMinutes)}`}
                            </span>
                          )}
                        </div>
                        {r.failureReason && (
                          <p className="mt-1 truncate text-[11px] text-rose-500">{r.failureReason}</p>
                        )}
                      </Card>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
