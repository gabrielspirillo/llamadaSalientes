'use client';

import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Select } from '@/components/ui/input';
import { STATUS_LABELS } from '@/lib/agenda/shared';
import type { CalendarBlock, CalendarItem } from '@/lib/agenda/view';
import { formatDateKeyLong, formatDateKeyShort } from '@/lib/agenda/view';
import { cn } from '@/lib/cn';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Users } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { AppointmentDialog, type AppointmentDialogSeed } from './appointment-dialog';
import { AppointmentSheet } from './appointment-sheet';

export interface CalendarProfessional {
  id: string;
  fullName: string;
  color: string;
  agendaEnabled: boolean;
  specialty: string | null;
}

export interface CalendarTreatment {
  id: string;
  name: string;
  durationMinutes: number;
}

export interface CalendarViewProps {
  view: 'day' | 'week';
  dateKey: string;
  dateKeys: string[];
  professionals: CalendarProfessional[];
  selectedProfessionalId: string;
  items: CalendarItem[];
  blocks: CalendarBlock[];
  treatments: CalendarTreatment[];
  timezone: string;
  window: { startMinute: number; endMinute: number };
  canWrite: boolean;
  /** Un profesional con agenda propia no elige: siempre ve la suya. */
  lockedToProfessional: boolean;
  todayKey: string;
}

/** Alto en píxeles de una hora de rejilla. */
const HOUR_PX = 64;

function minutesToTop(minute: number, windowStart: number): number {
  return ((minute - windowStart) / 60) * HOUR_PX;
}

function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

const STATUS_STYLES: Record<string, string> = {
  SCHEDULED: 'border-l-4',
  CONFIRMED: 'border-l-4',
  ARRIVED: 'border-l-4 ring-1 ring-brand-300',
  IN_PROGRESS: 'border-l-4 ring-1 ring-brand-400',
  COMPLETED: 'border-l-4 opacity-80',
  CANCELLED: 'border-l-4 opacity-45 line-through',
  NO_SHOW: 'border-l-4 opacity-60',
};

export function CalendarView(props: CalendarViewProps) {
  const {
    view,
    dateKey,
    dateKeys,
    professionals,
    selectedProfessionalId,
    items,
    blocks,
    treatments,
    window: dayWindow,
    canWrite,
    lockedToProfessional,
    todayKey,
    timezone,
  } = props;

  const router = useRouter();
  const searchParams = useSearchParams();
  const [seed, setSeed] = React.useState<AppointmentDialogSeed | null>(null);
  const [openItem, setOpenItem] = React.useState<CalendarItem | null>(null);

  const hours = React.useMemo(() => {
    const out: number[] = [];
    for (let m = dayWindow.startMinute; m <= dayWindow.endMinute; m += 60) out.push(m);
    return out;
  }, [dayWindow.startMinute, dayWindow.endMinute]);

  const gridHeight = ((dayWindow.endMinute - dayWindow.startMinute) / 60) * HOUR_PX;

  function navigate(patch: Record<string, string>) {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    router.push(`/dashboard/agenda?${next.toString()}`);
  }

  function shiftDays(days: number) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const base = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1));
    base.setUTCDate(base.getUTCDate() + days);
    const nextKey = `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`;
    navigate({ date: nextKey });
  }

  // Columnas: en vista de día, una por profesional (o una sola si hay uno
  // elegido). En vista de semana, una por día del profesional elegido.
  const visibleProfessionals =
    selectedProfessionalId === 'all'
      ? professionals.filter((p) => p.agendaEnabled)
      : professionals.filter((p) => p.id === selectedProfessionalId);

  const columns: {
    key: string;
    label: string;
    sublabel?: string;
    color?: string;
    professionalId: string;
    dateKey: string;
  }[] =
    view === 'week'
      ? dateKeys.map((k) => ({
          key: k,
          label: formatDateKeyShort(k),
          professionalId: visibleProfessionals[0]?.id ?? '',
          dateKey: k,
          color: visibleProfessionals[0]?.color,
        }))
      : visibleProfessionals.map((p) => ({
          key: p.id,
          label: p.fullName,
          sublabel: p.specialty ?? undefined,
          color: p.color,
          professionalId: p.id,
          dateKey,
        }));

  function itemsFor(column: { professionalId: string; dateKey: string }) {
    return items.filter(
      (i) => i.professionalId === column.professionalId && i.dateKey === column.dateKey,
    );
  }

  function blocksFor(column: { professionalId: string; dateKey: string }) {
    return blocks.filter(
      (b) => b.professionalId === column.professionalId && b.dateKey === column.dateKey,
    );
  }

  function handleGridClick(
    column: { professionalId: string; dateKey: string },
    event: React.MouseEvent<HTMLDivElement>,
  ) {
    if (!canWrite || !column.professionalId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    const rawMinute = dayWindow.startMinute + (offsetY / HOUR_PX) * 60;
    // Se redondea a la media hora hacia abajo: pinchar "más o menos a las 10"
    // tiene que abrir las 10:00, no las 10:07.
    const minute = Math.max(0, Math.min(1425, Math.floor(rawMinute / 30) * 30));
    setSeed({
      professionalId: column.professionalId,
      dateKey: column.dateKey,
      startMinute: minute,
    });
  }

  const hasAgenda = professionals.some((p) => p.agendaEnabled);

  return (
    <>
      <Card className="overflow-hidden">
        {/* Barra de control */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[--color-border-subtle] p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <IconButton label="Anterior" onClick={() => shiftDays(view === 'week' ? -7 : -1)}>
              <ChevronLeft className="h-4 w-4" />
            </IconButton>
            <Button variant="soft" size="sm" onClick={() => navigate({ date: todayKey })}>
              Hoy
            </Button>
            <IconButton label="Siguiente" onClick={() => shiftDays(view === 'week' ? 7 : 1)}>
              <ChevronRight className="h-4 w-4" />
            </IconButton>
            <div className="ml-1 min-w-0">
              <p className="truncate text-[15px] font-bold capitalize text-zinc-900">
                {view === 'week'
                  ? `Semana del ${formatDateKeyLong(dateKeys[0] ?? dateKey)}`
                  : formatDateKeyLong(dateKey)}
              </p>
              <p className="text-[12px] text-zinc-500">{timezone}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full bg-zinc-100 p-1">
              <button
                type="button"
                onClick={() => navigate({ view: 'day' })}
                className={cn(
                  'rounded-full px-3 py-1 text-[13px] font-semibold transition-colors',
                  view === 'day' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500',
                )}
              >
                Día
              </button>
              <button
                type="button"
                onClick={() => navigate({ view: 'week' })}
                className={cn(
                  'rounded-full px-3 py-1 text-[13px] font-semibold transition-colors',
                  view === 'week' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500',
                )}
              >
                Semana
              </button>
            </div>

            {!lockedToProfessional && (
              <Select
                aria-label="Profesional"
                className="h-9 w-auto min-w-[190px] text-[13px]"
                value={selectedProfessionalId}
                onChange={(e) => navigate({ prof: e.target.value })}
              >
                {view === 'day' && <option value="all">Todos los profesionales</option>}
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                    {p.agendaEnabled ? '' : ' (agenda apagada)'}
                  </option>
                ))}
              </Select>
            )}

            {canWrite && (
              <Button
                size="sm"
                onClick={() =>
                  setSeed({
                    professionalId:
                      selectedProfessionalId !== 'all'
                        ? selectedProfessionalId
                        : (visibleProfessionals[0]?.id ?? ''),
                    dateKey,
                    startMinute: Math.max(dayWindow.startMinute, 9 * 60),
                  })
                }
                disabled={!hasAgenda}
              >
                <Plus className="h-4 w-4" /> Nueva cita
              </Button>
            )}
          </div>
        </div>

        {!hasAgenda ? (
          <EmptyState
            icon={<CalendarDays className="h-5 w-5" />}
            title="Todavía no hay agendas habilitadas"
            description="Da de alta a los profesionales de la clínica y enciende su agenda para empezar a dar citas."
          />
        ) : columns.length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="Ese profesional no tiene la agenda habilitada"
            description="Enciende su agenda desde la ficha del profesional."
          />
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              {/* Cabecera de columnas */}
              <div
                className="grid border-b border-[--color-border-subtle]"
                style={{
                  gridTemplateColumns: `64px repeat(${columns.length}, minmax(150px, 1fr))`,
                }}
              >
                <div />
                {columns.map((c) => (
                  <div key={c.key} className="border-l border-[--color-border-subtle] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: c.color ?? '#37766a' }}
                      />
                      <span
                        className={cn(
                          'truncate text-[13px] font-bold capitalize text-zinc-800',
                          c.dateKey === todayKey && view === 'week' && 'text-brand-700',
                        )}
                      >
                        {c.label}
                      </span>
                    </div>
                    {c.sublabel && (
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500">{c.sublabel}</p>
                    )}
                  </div>
                ))}
              </div>

              {/* Rejilla */}
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `64px repeat(${columns.length}, minmax(150px, 1fr))`,
                }}
              >
                {/* Horas */}
                <div className="relative" style={{ height: gridHeight }}>
                  {hours.map((h, i) => (
                    <div
                      key={h}
                      className={cn(
                        'absolute right-2 text-[11px] font-medium tabular-nums text-zinc-400',
                        // La primera etiqueta se alinea al borde: centrada se
                        // saldría por arriba de la rejilla y quedaba cortada.
                        i === 0 ? 'translate-y-0' : '-translate-y-1/2',
                      )}
                      style={{ top: minutesToTop(h, dayWindow.startMinute) }}
                    >
                      {hhmm(h)}
                    </div>
                  ))}
                </div>

                {columns.map((column) => (
                  <div
                    key={column.key}
                    className="relative border-l border-[--color-border-subtle]"
                    style={{ height: gridHeight }}
                    onClick={(e) => handleGridClick(column, e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && canWrite) {
                        setSeed({
                          professionalId: column.professionalId,
                          dateKey: column.dateKey,
                          startMinute: Math.max(dayWindow.startMinute, 9 * 60),
                        });
                      }
                    }}
                    role={canWrite ? 'button' : undefined}
                    tabIndex={canWrite ? 0 : undefined}
                    aria-label={canWrite ? `Añadir cita en ${column.label}` : undefined}
                  >
                    {/* Líneas de hora */}
                    {hours.map((h) => (
                      <div
                        key={h}
                        aria-hidden
                        className="absolute inset-x-0 border-t border-[--color-border-subtle]"
                        style={{ top: minutesToTop(h, dayWindow.startMinute) }}
                      />
                    ))}

                    {/* Bloqueos */}
                    {blocksFor(column).map((b) => {
                      // Se recorta a la ventana: un bloqueo de día completo
                      // empieza a las 00:00 y la rejilla arranca más tarde.
                      const from = Math.max(b.startMinute, dayWindow.startMinute);
                      const to = Math.min(b.endMinute, dayWindow.endMinute);
                      if (to <= from) return null;
                      return (
                        <div
                          key={`${b.id}-${b.dateKey}`}
                          className="pointer-events-none absolute inset-x-1 rounded-lg bg-[repeating-linear-gradient(45deg,rgba(120,120,120,0.12),rgba(120,120,120,0.12)_6px,transparent_6px,transparent_12px)] ring-1 ring-zinc-200"
                          style={{
                            top: minutesToTop(from, dayWindow.startMinute),
                            height: Math.max(18, ((to - from) / 60) * HOUR_PX),
                          }}
                        >
                          <span className="block truncate px-2 py-1 text-[11px] font-semibold text-zinc-500">
                            {b.reason ?? 'No disponible'}
                          </span>
                        </div>
                      );
                    })}

                    {/* Citas */}
                    {layout(itemsFor(column)).map(({ item, lane, lanes }) => {
                      const alto = Math.max(
                        22,
                        ((item.endMinute - item.startMinute) / 60) * HOUR_PX - 2,
                      );
                      // En un bloque de 30 min sólo entran dos líneas; en uno de
                      // 15, una. Escribir tres deja el texto cortado por la mitad.
                      const lineas = alto >= 56 ? 3 : alto >= 32 ? 2 : 1;
                      return (
                        <button
                          key={`${item.id}-${item.dateKey}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenItem(item);
                          }}
                          className={cn(
                            'absolute overflow-hidden rounded-lg bg-white px-2 py-1 text-left shadow-[0_6px_16px_-10px_rgba(20,33,29,0.5)] ring-1 ring-black/5 transition-transform duration-200 hover:z-10 hover:scale-[1.01]',
                            STATUS_STYLES[item.status],
                          )}
                          style={{
                            top: minutesToTop(item.startMinute, dayWindow.startMinute),
                            height: alto,
                            left: `calc(${(lane / lanes) * 100}% + 4px)`,
                            width: `calc(${100 / lanes}% - 8px)`,
                            borderLeftColor: item.color,
                            backgroundColor: `${item.color}12`,
                          }}
                        >
                          <span className="block truncate text-[12px] font-bold leading-tight text-zinc-900">
                            {lineas === 1
                              ? `${hhmm(item.startMinute)} ${item.patientName}`
                              : item.patientName}
                          </span>
                          {lineas >= 2 && (
                            <span className="block truncate text-[11px] leading-tight text-zinc-600">
                              {hhmm(item.startMinute)}
                              {item.treatmentName ? ` · ${item.treatmentName}` : ''}
                            </span>
                          )}
                          {lineas >= 3 && (
                            <span className="block truncate text-[10px] leading-tight text-zinc-500">
                              {STATUS_LABELS[item.status]}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Leyenda de estados */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'COMPLETED', 'NO_SHOW'] as const).map((s) => (
          <Badge key={s} tone="neutral" className="text-[11px]">
            {STATUS_LABELS[s]}
          </Badge>
        ))}
      </div>

      {seed && (
        <AppointmentDialog
          seed={seed}
          professionals={professionals.filter((p) => p.agendaEnabled)}
          treatments={treatments}
          onClose={() => setSeed(null)}
        />
      )}

      {openItem && (
        <AppointmentSheet
          item={openItem}
          canWrite={canWrite}
          treatments={treatments}
          onClose={() => setOpenItem(null)}
        />
      )}
    </>
  );
}

/**
 * Reparte en carriles las citas que se solapan, como hace cualquier agenda:
 * dos citas a la misma hora en la misma columna se ponen lado a lado en vez de
 * taparse. Es un algoritmo de barrido, no hace falta nada más sofisticado.
 */
function layout(items: CalendarItem[]): { item: CalendarItem; lane: number; lanes: number }[] {
  const sorted = [...items].sort((a, b) => a.startMinute - b.startMinute);
  const out: { item: CalendarItem; lane: number; lanes: number }[] = [];

  let cluster: CalendarItem[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const assigned = cluster.map((item) => {
      let lane = laneEnds.findIndex((end) => end <= item.startMinute);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.endMinute);
      } else {
        laneEnds[lane] = item.endMinute;
      }
      return { item, lane };
    });
    for (const a of assigned) out.push({ ...a, lanes: laneEnds.length });
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.startMinute >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMinute);
  }
  flush();

  return out;
}
