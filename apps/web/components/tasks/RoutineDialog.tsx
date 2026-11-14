'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import {
  CATEGORY_META,
  TASK_CATEGORIES,
  type TaskCategory,
  WEEKDAY_LABELS,
} from '@/lib/tasks/constants';
import type { TaskMember } from '@/lib/tasks/types';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

/**
 * Alta de una rutina propia: la clínica decide qué se repite y cuándo. Sin
 * catálogo de serie (se retiró el 14/11/2026: nadie lo usaba y llenaba el
 * tablero). Cuatro preguntas: qué, cada cuánto, a qué hora y quién.
 */

type Freq = 'DAILY' | 'WEEKDAYS' | 'WEEKLY' | 'MONTHLY';

const FREQS: { value: Freq; label: string }[] = [
  { value: 'WEEKDAYS', label: 'De lunes a viernes' },
  { value: 'DAILY', label: 'Todos los días' },
  { value: 'WEEKLY', label: 'Una vez por semana' },
  { value: 'MONTHLY', label: 'Una vez al mes' },
];

export function RoutineDialog({
  open,
  onOpenChange,
  members,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  members: TaskMember[];
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [freq, setFreq] = useState<Freq>('WEEKDAYS');
  const [weekday, setWeekday] = useState(1);
  const [monthDay, setMonthDay] = useState(1);
  const [time, setTime] = useState('09:00');
  const [assignee, setAssignee] = useState('');
  const [category, setCategory] = useState<TaskCategory>('ADMIN');
  const [steps, setSteps] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) {
      setError('Ponle un nombre a la rutina.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks/templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          category,
          recurrenceFreq: freq,
          recurrenceWeekdays: freq === 'WEEKLY' ? [weekday] : [],
          recurrenceMonthDay: freq === 'MONTHLY' ? monthDay : null,
          dueTime: time,
          defaultAssigneeUserId: assignee || null,
          items: steps
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'No se pudo crear la rutina');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva rutina</DialogTitle>
          <DialogDescription>
            Una tarea que se crea sola cada vez que toca. Sólo lo que de verdad hay que recordar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="rt-name">Qué hay que hacer</Label>
            <Input
              id="rt-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej.: Revisar el stock de material"
              autoFocus
            />
          </div>

          <div>
            <Label>Cada cuánto</Label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {FREQS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFreq(f.value)}
                  aria-pressed={freq === f.value}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-left text-[13px] font-medium transition-colors',
                    freq === f.value
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                      : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {freq === 'WEEKLY' && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setWeekday(d)}
                    aria-pressed={weekday === d}
                    className={cn(
                      'rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                      weekday === d
                        ? 'border-zinc-900 bg-zinc-900 text-white'
                        : 'border-zinc-200 bg-white text-zinc-600',
                    )}
                  >
                    {WEEKDAY_LABELS[d]}
                  </button>
                ))}
              </div>
            )}
            {freq === 'MONTHLY' && (
              <div className="mt-2 flex items-center gap-2 text-[13px] text-zinc-600">
                El día
                <Select
                  value={String(monthDay)}
                  onChange={(e) => setMonthDay(Number(e.target.value))}
                  className="w-20"
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
                de cada mes
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rt-time">A qué hora</Label>
              <Input
                id="rt-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="rt-who">Quién</Label>
              <Select id="rt-who" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Cualquiera del equipo</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="rt-cat">Tipo</Label>
            <Select
              id="rt-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value as TaskCategory)}
            >
              {TASK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_META[c].label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="rt-steps">Pasos (opcional, uno por línea)</Label>
            <Textarea
              id="rt-steps"
              rows={3}
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              placeholder={'Contar guantes\nPedir lo que falte'}
            />
          </div>

          {error && <p className="text-[13px] text-rose-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Crear rutina
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
