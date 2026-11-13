'use client';

import { Button } from '@/components/ui/button';
import { Card, CardTopbar } from '@/components/ui/card';
import { Callout } from '@/components/ui/feedback';
import { Input, Label, Switch } from '@/components/ui/input';
import {
  type MinuteRange,
  describeRanges,
  formatClockInput,
  longDayLabel,
  normalizeRanges,
  parseClock,
} from '@/lib/agenda/special-days';
import { CalendarClock, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';
import { deleteSpecialDayAction, saveSpecialDayAction } from './special-days-actions';

export type SpecialDaysProfessional = {
  id: string;
  fullName: string;
  /** Horario semanal: ISO 1 = lunes … 7 = domingo. */
  shifts: { weekday: number; startMinute: number; endMinute: number }[];
};

export type SpecialDayItem = {
  id: string;
  professionalId: string;
  day: string;
  ranges: MinuteRange[];
  note: string | null;
};

function isoWeekday(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

/** El horario habitual de ese día de la semana para un profesional, o null si no trabaja. */
function usualRange(p: SpecialDaysProfessional | undefined, day: string): MinuteRange | null {
  const wd = isoWeekday(day);
  if (!p || !wd) return null;
  const ofDay = p.shifts.filter((s) => s.weekday === wd);
  if (ofDay.length === 0) return null;
  return {
    start: Math.min(...ofDay.map((s) => s.startMinute)),
    end: Math.max(...ofDay.map((s) => s.endMinute)),
  };
}

/**
 * "Días con horario especial": abrir una mañana suelta (y decir si esa tarde
 * también se trabaja) sin tocar el horario de siempre. Lo que se guarda aquí
 * lo usan la agenda del panel y los asistentes (WhatsApp y teléfono).
 */
export function SpecialDaysCard({
  canEdit,
  professionals,
  days,
  todayKey,
  clinicClosedWeekdays,
}: {
  canEdit: boolean;
  professionals: SpecialDaysProfessional[];
  days: SpecialDayItem[];
  todayKey: string;
  /** Días de la semana (ISO) en que la clínica no abre normalmente. */
  clinicClosedWeekdays: number[];
}) {
  const [day, setDay] = useState('');
  const [selected, setSelected] = useState<string[]>(professionals.map((p) => p.id));
  const [morningOn, setMorningOn] = useState(true);
  const [morningFrom, setMorningFrom] = useState('09:00');
  const [morningTo, setMorningTo] = useState('13:00');
  const [afternoonOn, setAfternoonOn] = useState(true);
  const [afternoonFrom, setAfternoonFrom] = useState('15:00');
  const [afternoonTo, setAfternoonTo] = useState('20:00');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<{
    tone: 'success' | 'warn' | 'danger';
    text: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const nameOf = useMemo(
    () => new Map(professionals.map((p) => [p.id, p.fullName])),
    [professionals],
  );
  const multi = professionals.length > 1;

  // Cada fecha con sus profesionales (una fila por profesional en la base).
  const grouped = useMemo(() => {
    const map = new Map<string, SpecialDayItem[]>();
    for (const d of days) {
      const list = map.get(d.day) ?? [];
      list.push(d);
      map.set(d.day, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [days]);

  /** Al elegir fecha: si ya tiene horario especial, se edita; si no, se propone el habitual por la tarde. */
  function pickDay(value: string) {
    setDay(value);
    setResult(null);
    const existing = days.filter((d) => d.day === value);
    if (existing.length > 0) {
      loadExisting(value, existing);
      return;
    }
    setEditing(false);
    const usual = usualRange(
      professionals.find((p) => selected.includes(p.id)),
      value,
    );
    if (usual) {
      setAfternoonOn(true);
      setAfternoonFrom(formatClockInput(usual.start));
      setAfternoonTo(formatClockInput(usual.end));
    } else {
      // Ese día no trabaja normalmente (p. ej. un sábado): sólo la mañana.
      setAfternoonOn(false);
    }
  }

  function loadExisting(value: string, existing: SpecialDayItem[]) {
    const first = existing[0];
    if (!first) return;
    setDay(value);
    setEditing(true);
    setSelected(existing.map((e) => e.professionalId));
    const morning = first.ranges.find((r) => r.start < 14 * 60);
    const afternoon = first.ranges.find((r) => r.start >= 14 * 60);
    setMorningOn(Boolean(morning));
    if (morning) {
      setMorningFrom(formatClockInput(morning.start));
      setMorningTo(formatClockInput(morning.end));
    }
    setAfternoonOn(Boolean(afternoon));
    if (afternoon) {
      setAfternoonFrom(formatClockInput(afternoon.start));
      setAfternoonTo(formatClockInput(afternoon.end));
    }
    setNote(first.note ?? '');
  }

  // Las franjas tal como se guardarán, o el error que lo impide.
  const draft = useMemo(() => {
    const ranges: MinuteRange[] = [];
    if (morningOn) {
      const s = parseClock(morningFrom);
      const e = parseClock(morningTo);
      if (s === null || e === null) return { error: 'Revisa las horas de la mañana.' };
      ranges.push({ start: s, end: e });
    }
    if (afternoonOn) {
      const s = parseClock(afternoonFrom);
      const e = parseClock(afternoonTo);
      if (s === null || e === null) return { error: 'Revisa las horas de la tarde.' };
      ranges.push({ start: s, end: e });
    }
    if (ranges.length === 0) {
      return { error: 'Marca la mañana, la tarde o las dos.' };
    }
    const norm = normalizeRanges(ranges);
    return norm.ok ? { ranges: norm.ranges } : { error: norm.error };
  }, [morningOn, morningFrom, morningTo, afternoonOn, afternoonFrom, afternoonTo]);

  const weekday = isoWeekday(day);
  const normallyClosed = weekday !== null && clinicClosedWeekdays.includes(weekday);
  const canSave =
    canEdit && !pending && day >= todayKey && selected.length > 0 && 'ranges' in draft;

  function save() {
    if (!('ranges' in draft) || !draft.ranges) return;
    const ranges = draft.ranges;
    startTransition(async () => {
      // Al editar, quien se quitó de la lista deja de tener horario especial ese día.
      const removed = days.filter((d) => d.day === day && !selected.includes(d.professionalId));
      if (removed.length > 0) {
        const del = await deleteSpecialDayAction(removed.map((r) => r.id));
        if (!del.ok) {
          setResult({ tone: 'danger', text: del.error });
          return;
        }
      }
      const res = await saveSpecialDayAction({
        day,
        professionalIds: selected,
        ranges,
        note: note.trim() || null,
      });
      if (!res.ok) {
        setResult({ tone: 'danger', text: res.error });
        return;
      }
      setResult(
        res.outside > 0
          ? {
              tone: 'warn',
              text: `Guardado. Ojo: ese día hay ${res.outside === 1 ? 'una cita' : `${res.outside} citas`} fuera de este horario. No se han tocado: revísalas en la agenda.`,
            }
          : {
              tone: 'success',
              text: `Guardado: ${longDayLabel(day)}, ${res.summary}. La agenda y los asistentes ya ofrecen esas horas.`,
            },
      );
      setEditing(true);
    });
  }

  function remove(dayKey: string, items: SpecialDayItem[]) {
    if (
      !window.confirm(
        `¿Quitar el horario especial del ${longDayLabel(dayKey)}? Ese día vuelve el horario de siempre. Las citas que ya estén dadas no se tocan.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await deleteSpecialDayAction(items.map((i) => i.id));
      if (!res.ok) {
        setResult({ tone: 'danger', text: res.error });
        return;
      }
      setResult({
        tone: 'success',
        text: `Quitado: el ${longDayLabel(dayKey)} vuelve el horario de siempre.`,
      });
      if (day === dayKey) {
        setDay('');
        setEditing(false);
      }
    });
  }

  return (
    <Card>
      <CardTopbar
        icon={<CalendarClock className="h-4 w-4" />}
        tone="honey"
        title="Días con horario especial"
      />
      <div className="space-y-5 px-5 pb-5 sm:px-6 sm:pb-6">
        <p className="text-sm leading-relaxed text-zinc-600">
          Para abrir algún día en otro horario sin tocar el de siempre (por ejemplo, una mañana
          suelta). Ese día la agenda y los asistentes de WhatsApp y teléfono ofrecen exactamente
          estas horas; el resto de días no cambia nada.
        </p>
        {professionals.length === 0 ? (
          <Callout tone="info">
            Para abrir un día especial primero tiene que haber un profesional con agenda (Agenda →
            Profesionales).
          </Callout>
        ) : (
          <>
            {canEdit ? (
              <div className="space-y-5">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="special-day">Día</Label>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Input
                      id="special-day"
                      type="date"
                      min={todayKey}
                      value={day}
                      onChange={(e) => pickDay(e.target.value)}
                      className="w-full max-w-[13rem]"
                    />
                    {day ? (
                      <span className="text-sm text-zinc-600">
                        {cap(longDayLabel(day))}
                        {editing ? (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            ya tiene horario especial
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                </div>

                {normallyClosed ? (
                  <Callout tone="info">
                    Ese día la clínica normalmente no abre. Con esto se abrirá sólo en las horas que
                    marques.
                  </Callout>
                ) : null}

                {multi ? (
                  <fieldset className="flex flex-col gap-1.5">
                    <legend className="mb-1.5 text-[14px] font-semibold tracking-tight text-zinc-700">
                      Quién trabaja ese día
                    </legend>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      {professionals.map((p) => (
                        <label key={p.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-zinc-300"
                            checked={selected.includes(p.id)}
                            onChange={(e) =>
                              setSelected((cur) =>
                                e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id),
                              )
                            }
                          />
                          {p.fullName}
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-zinc-500">
                      Quien no esté marcado trabaja ese día con su horario de siempre.
                    </p>
                  </fieldset>
                ) : null}

                <div className="divide-y divide-(--color-border-subtle) border-y border-(--color-border-subtle)">
                  <RangeRow
                    label="Abre por la mañana"
                    on={morningOn}
                    onToggle={setMorningOn}
                    from={morningFrom}
                    to={morningTo}
                    onFrom={setMorningFrom}
                    onTo={setMorningTo}
                    offText="No abre por la mañana"
                    ariaPrefix="Mañana"
                  />
                  <RangeRow
                    label="Esa tarde también trabaja"
                    on={afternoonOn}
                    onToggle={setAfternoonOn}
                    from={afternoonFrom}
                    to={afternoonTo}
                    onFrom={setAfternoonFrom}
                    onTo={setAfternoonTo}
                    offText="Esa tarde no trabaja"
                    ariaPrefix="Tarde"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="special-note">
                    Nota{' '}
                    <span className="font-normal text-zinc-500">
                      (opcional, sólo para el equipo)
                    </span>
                  </Label>
                  <Input
                    id="special-note"
                    value={note}
                    maxLength={200}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Ej.: mañana para primeras visitas"
                  />
                </div>

                {'ranges' in draft && draft.ranges ? (
                  <Callout tone="brand">
                    Ese día se ofrecerán citas <strong>{describeRanges(draft.ranges)}</strong>.
                  </Callout>
                ) : (
                  <Callout tone="warn">{draft.error}</Callout>
                )}

                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Button type="button" onClick={save} disabled={!canSave}>
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {editing ? 'Guardar cambios' : 'Guardar día especial'}
                  </Button>
                  {!day ? (
                    <span className="text-sm text-zinc-500">Elige primero el día.</span>
                  ) : null}
                </div>
              </div>
            ) : (
              <Callout tone="info">
                Sólo un administrador de la clínica puede abrir o quitar días especiales.
              </Callout>
            )}

            {result ? <Callout tone={result.tone}>{result.text}</Callout> : null}

            <div>
              <h4 className="mb-2 text-sm font-semibold text-zinc-800">Próximos días especiales</h4>
              {grouped.length === 0 ? (
                <p className="text-sm text-zinc-500">No hay ninguno.</p>
              ) : (
                <ul className="divide-y divide-(--color-border-subtle) border-y border-(--color-border-subtle)">
                  {grouped.map(([dayKey, items]) => {
                    const first = items[0];
                    const sameForAll = items.every(
                      (i) => describeRanges(i.ranges) === describeRanges(first?.ranges ?? []),
                    );
                    return (
                      <li
                        key={dayKey}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-zinc-900">
                            {cap(longDayLabel(dayKey))}
                          </p>
                          <p className="text-sm text-zinc-600">
                            {sameForAll
                              ? describeRanges(first?.ranges ?? [])
                              : items
                                  .map(
                                    (i) =>
                                      `${nameOf.get(i.professionalId) ?? 'Profesional'}: ${describeRanges(i.ranges)}`,
                                  )
                                  .join(' · ')}
                            {multi && sameForAll
                              ? ` · ${items.map((i) => nameOf.get(i.professionalId) ?? 'Profesional').join(', ')}`
                              : ''}
                            {first?.note ? ` · ${first.note}` : ''}
                          </p>
                        </div>
                        {canEdit ? (
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="soft"
                              size="sm"
                              onClick={() => {
                                setResult(null);
                                loadExisting(dayKey, items);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Editar
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={pending}
                              onClick={() => remove(dayKey, items)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Quitar
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/** Una franja (mañana o tarde): interruptor + "desde a hasta". En móvil, las horas bajan. */
function RangeRow({
  label,
  on,
  onToggle,
  from,
  to,
  onFrom,
  onTo,
  offText,
  ariaPrefix,
}: {
  label: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  offText: string;
  ariaPrefix: string;
}) {
  return (
    <div className="grid gap-x-4 gap-y-2 py-3 sm:grid-cols-[minmax(0,15rem)_1fr] sm:items-center">
      <div className="flex items-center gap-3">
        <Switch checked={on} onCheckedChange={onToggle} label={label} />
        <span className="text-sm font-medium text-zinc-800">{label}</span>
      </div>
      {on ? (
        <div className="flex min-w-0 items-center gap-2 sm:pl-0">
          <Input
            type="time"
            value={from}
            onChange={(e) => onFrom(e.target.value)}
            className="min-w-0 flex-1 sm:max-w-[9.5rem]"
            aria-label={`${ariaPrefix} desde`}
          />
          <span className="shrink-0 text-sm text-zinc-500">a</span>
          <Input
            type="time"
            value={to}
            onChange={(e) => onTo(e.target.value)}
            className="min-w-0 flex-1 sm:max-w-[9.5rem]"
            aria-label={`${ariaPrefix} hasta`}
          />
        </div>
      ) : (
        <span className="text-sm text-zinc-500">{offText}</span>
      )}
    </div>
  );
}

/** "viernes 20 de noviembre" → "Viernes 20 de noviembre" (sólo la primera letra). */
function cap(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
