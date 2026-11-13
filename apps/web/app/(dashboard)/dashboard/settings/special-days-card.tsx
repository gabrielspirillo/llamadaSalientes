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
        subtitle="Para abrir algún día por la mañana (o en otro horario) sin cambiar el horario de siempre. Ese día la agenda y los asistentes ofrecen exactamente estas horas."
      />
      <div className="space-y-5 px-5 pb-5 sm:px-6 sm:pb-6">
        {professionals.length === 0 ? (
          <Callout tone="info">
            Para abrir un día especial primero tiene que haber un profesional con agenda (Agenda →
            Profesionales).
          </Callout>
        ) : (
          <>
            {canEdit ? (
              <div className="space-y-4 rounded-[18px] border border-(--color-border-subtle) bg-white/60 p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <Label htmlFor="special-day">Día</Label>
                    <Input
                      id="special-day"
                      type="date"
                      min={todayKey}
                      value={day}
                      onChange={(e) => pickDay(e.target.value)}
                      className="w-44"
                    />
                  </div>
                  {day ? (
                    <p className="pb-2 text-sm text-zinc-600">
                      {longDayLabel(day)}
                      {editing ? ' · ya tiene horario especial' : ''}
                    </p>
                  ) : null}
                </div>

                {normallyClosed ? (
                  <Callout tone="info">
                    Ese día la clínica normalmente no abre. Con esto se abrirá sólo en las horas que
                    marques.
                  </Callout>
                ) : null}

                {multi ? (
                  <fieldset>
                    <legend className="mb-1.5 text-sm font-medium text-zinc-800">
                      Quién trabaja ese día
                    </legend>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
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
                    <p className="mt-1 text-xs text-zinc-500">
                      Quien no esté marcado trabaja ese día con su horario de siempre.
                    </p>
                  </fieldset>
                ) : null}

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Switch
                      checked={morningOn}
                      onCheckedChange={setMorningOn}
                      label="Abre por la mañana"
                    />
                    <span className="w-40 text-sm font-medium">Abre por la mañana</span>
                    {morningOn ? (
                      <span className="flex items-center gap-2">
                        <Input
                          type="time"
                          value={morningFrom}
                          onChange={(e) => setMorningFrom(e.target.value)}
                          className="w-28"
                          aria-label="Mañana desde"
                        />
                        <span className="text-sm text-zinc-500">a</span>
                        <Input
                          type="time"
                          value={morningTo}
                          onChange={(e) => setMorningTo(e.target.value)}
                          className="w-28"
                          aria-label="Mañana hasta"
                        />
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Switch
                      checked={afternoonOn}
                      onCheckedChange={setAfternoonOn}
                      label="Esa tarde también trabaja"
                    />
                    <span className="w-40 text-sm font-medium">Esa tarde también trabaja</span>
                    {afternoonOn ? (
                      <span className="flex items-center gap-2">
                        <Input
                          type="time"
                          value={afternoonFrom}
                          onChange={(e) => setAfternoonFrom(e.target.value)}
                          className="w-28"
                          aria-label="Tarde desde"
                        />
                        <span className="text-sm text-zinc-500">a</span>
                        <Input
                          type="time"
                          value={afternoonTo}
                          onChange={(e) => setAfternoonTo(e.target.value)}
                          className="w-28"
                          aria-label="Tarde hasta"
                        />
                      </span>
                    ) : (
                      <span className="text-sm text-zinc-500">Esa tarde no trabaja</span>
                    )}
                  </div>
                </div>

                <div>
                  <Label htmlFor="special-note">Nota (opcional, sólo para el equipo)</Label>
                  <Input
                    id="special-note"
                    value={note}
                    maxLength={200}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Ej.: mañana para primeras visitas"
                  />
                </div>

                <p className="text-sm text-zinc-700">
                  {'ranges' in draft && draft.ranges ? (
                    <>
                      Ese día se ofrecerán citas <strong>{describeRanges(draft.ranges)}</strong>.
                    </>
                  ) : (
                    <span className="text-rose-700">{draft.error}</span>
                  )}
                </p>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={save} disabled={!canSave}>
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {editing ? 'Guardar cambios' : 'Guardar día especial'}
                  </Button>
                  {!day ? (
                    <span className="self-center text-sm text-zinc-500">Elige primero el día.</span>
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
                <ul className="divide-y divide-(--color-border-subtle) rounded-[18px] border border-(--color-border-subtle) bg-white/60">
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
                          <p className="text-sm font-medium capitalize text-zinc-900">
                            {longDayLabel(dayKey)}
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
