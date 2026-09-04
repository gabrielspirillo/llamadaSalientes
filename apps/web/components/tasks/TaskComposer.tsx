'use client';

import { Avatar } from '@/components/tasks/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Select, Switch, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import {
  CATEGORY_META,
  PRIORITY_META,
  STATUS_META,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskCategory,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/tasks/constants';
import { parseQuickTask } from '@/lib/tasks/quick-parse';
import type { TaskMember } from '@/lib/tasks/types';
import {
  CalendarClock,
  Check,
  GripVertical,
  ListChecks,
  Loader2,
  Plus,
  ShieldCheck,
  Tag,
  User,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

/** Minúsculas y sin tildes, para comparar nombres como los escribe la gente. */
function fold(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function toTimeInput(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface ChecklistRow {
  _k: string;
  text: string;
}

/**
 * Alta de tarea completa.
 *
 * El alta rápida de una línea sigue estando para lo urgente; esto es para
 * cuando la tarea lo merece: descripción, checklist, varios responsables,
 * etiquetas, paciente vinculado y candado de evidencia. Todo lo que el backend
 * ya sabía guardar y no había forma de rellenar desde la UI.
 */
export function TaskComposer({
  open,
  onOpenChange,
  members,
  defaultStatus,
  initialText,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  members: TaskMember[];
  defaultStatus: TaskStatus;
  /** Texto del alta rápida, para abrir "Más opciones" sin perder lo escrito. */
  initialText?: string;
  onCreated: () => void;
}) {
  const seed = useMemo(() => parseQuickTask(initialText ?? ''), [initialText]);
  const seededAssignees = useMemo(() => {
    return seed.assigneeHints
      .map((hint) => {
        const needle = fold(hint);
        return members.find(
          (m) => fold(m.name).startsWith(needle) || fold(m.email).startsWith(needle),
        );
      })
      .filter((m): m is TaskMember => !!m)
      .map((m) => m.userId);
  }, [seed.assigneeHints, members]);

  const [title, setTitle] = useState(seed.title);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TaskCategory | ''>(seed.category ?? '');
  const [priority, setPriority] = useState<TaskPriority>(seed.priority ?? 'MEDIUM');
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);
  const [dueDate, setDueDate] = useState(seed.dueAt ? toDateInput(seed.dueAt) : '');
  const [dueTime, setDueTime] = useState(
    seed.dueAt && !seed.dueAllDay ? toTimeInput(seed.dueAt) : '',
  );
  const [dueAllDay, setDueAllDay] = useState(seed.dueAt ? seed.dueAllDay : true);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(seededAssignees);
  const [labels, setLabels] = useState<string[]>(seed.labels);
  const [labelDraft, setLabelDraft] = useState('');
  const [requiresEvidence, setRequiresEvidence] = useState(false);

  const keySeq = useRef(0);
  const mint = () => {
    keySeq.current += 1;
    return `s${keySeq.current}`;
  };
  const [checklist, setChecklist] = useState<ChecklistRow[]>([]);
  const [stepDraft, setStepDraft] = useState('');

  const [showPatient, setShowPatient] = useState(false);
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleAssignee = (userId: string) => {
    setAssigneeIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  const addLabel = () => {
    const v = labelDraft.trim().replace(/^#/, '').slice(0, 40);
    if (!v) return;
    if (!labels.includes(v) && labels.length < 12) setLabels((prev) => [...prev, v]);
    setLabelDraft('');
  };

  const addStep = () => {
    const v = stepDraft.trim();
    if (!v || checklist.length >= 50) return;
    setChecklist((prev) => [...prev, { _k: mint(), text: v.slice(0, 300) }]);
    setStepDraft('');
  };

  const buildDueAt = (): { dueAt?: string; dueAllDay: boolean } => {
    if (!dueDate) return { dueAt: undefined, dueAllDay: false };
    const [yStr, mStr, dStr] = dueDate.split('-');
    const y = Number(yStr) || 0;
    const mo = (Number(mStr) || 1) - 1;
    const da = Number(dStr) || 1;
    if (dueAllDay || !dueTime) {
      return { dueAt: new Date(y, mo, da, 0, 0, 0).toISOString(), dueAllDay: true };
    }
    const [hhStr, mmStr] = dueTime.split(':');
    const hh = Number(hhStr) || 0;
    const mm = Number(mmStr) || 0;
    return { dueAt: new Date(y, mo, da, hh, mm, 0).toISOString(), dueAllDay: false };
  };

  const submit = async () => {
    setError(null);
    if (!title.trim()) return setError('Escribe al menos qué hay que hacer.');
    const due = buildDueAt();
    setBusy(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          category: category || undefined,
          priority,
          status,
          dueAt: due.dueAt,
          dueAllDay: due.dueAllDay,
          requiresEvidence,
          labels: labels.length > 0 ? labels : undefined,
          assigneeUserIds: assigneeIds.length > 0 ? assigneeIds : undefined,
          checklist:
            checklist.length > 0 ? checklist.map((c) => c.text).filter(Boolean) : undefined,
          patientName: patientName.trim() || undefined,
          patientPhone: patientPhone.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'No se pudo crear la tarea');
      onCreated();
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nueva tarea</DialogTitle>
          <DialogDescription>
            Todo lo que la tarea necesite: pasos, responsables, paciente y evidencia.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* ── Qué hay que hacer ─────────────────────────────────────────── */}
          <div>
            <Input
              aria-label="Título"
              value={title}
              maxLength={300}
              placeholder="¿Qué hay que hacer?"
              className="h-12 text-base font-medium"
              onChange={(e) => setTitle(e.target.value)}
            />
            <Textarea
              aria-label="Descripción"
              value={description}
              maxLength={4000}
              placeholder="Añade contexto: qué, para quién, cómo se sabe que está hecho…"
              className="mt-2 min-h-[80px]"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* ── Clasificación ─────────────────────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="tc-cat">Categoría</Label>
              <Select
                id="tc-cat"
                className="mt-1.5"
                value={category}
                onChange={(e) => setCategory(e.target.value as TaskCategory | '')}
              >
                <option value="">Sin categoría</option>
                {TASK_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_META[c].label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="tc-prio">Prioridad</Label>
              <Select
                id="tc-prio"
                className="mt-1.5"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
              >
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_META[p].label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="tc-status">Columna</Label>
              <Select
                id="tc-status"
                className="mt-1.5"
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s].label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* ── Cuándo ────────────────────────────────────────────────────── */}
          <section className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-zinc-800">
              <CalendarClock className="h-4 w-4 text-zinc-400" />
              Vencimiento
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="tc-date" className="text-[12px]">
                  Día
                </Label>
                <Input
                  id="tc-date"
                  type="date"
                  className="mt-1 h-10 w-auto"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              {!dueAllDay && (
                <div>
                  <Label htmlFor="tc-time" className="text-[12px]">
                    Hora
                  </Label>
                  <Input
                    id="tc-time"
                    type="time"
                    className="mt-1 h-10 w-auto"
                    value={dueTime}
                    disabled={!dueDate}
                    onChange={(e) => setDueTime(e.target.value)}
                  />
                </div>
              )}
              <span className="flex items-center gap-2 pb-2 text-sm text-zinc-600">
                <Switch checked={dueAllDay} onCheckedChange={setDueAllDay} label="Todo el día" />
                Todo el día
              </span>
            </div>
          </section>

          {/* ── Responsables ──────────────────────────────────────────────── */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-zinc-800">
              <User className="h-4 w-4 text-zinc-400" />
              Responsables
            </p>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const on = assigneeIds.includes(m.userId);
                return (
                  <button
                    key={m.userId}
                    type="button"
                    onClick={() => toggleAssignee(m.userId)}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-colors',
                      on
                        ? 'border-brand-400 bg-brand-50 text-brand-800'
                        : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300',
                    )}
                  >
                    <Avatar member={m} size="sm" />
                    {m.name}
                    {on && <Check className="h-3.5 w-3.5" />}
                  </button>
                );
              })}
              {members.length === 0 && (
                <span className="text-xs text-zinc-500">No hay miembros en el equipo todavía.</span>
              )}
            </div>
          </div>

          {/* ── Checklist ─────────────────────────────────────────────────── */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-zinc-800">
              <ListChecks className="h-4 w-4 text-zinc-400" />
              Pasos ({checklist.length})
            </p>
            {checklist.length > 0 && (
              <ul className="mb-2 space-y-1.5">
                {checklist.map((row, idx) => (
                  <li
                    key={row._k}
                    className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5"
                  >
                    <GripVertical className="h-3.5 w-3.5 shrink-0 text-zinc-300" />
                    <input
                      aria-label={`Paso ${idx + 1}`}
                      value={row.text}
                      maxLength={300}
                      onChange={(e) =>
                        setChecklist((prev) =>
                          prev.map((r) => (r._k === row._k ? { ...r, text: e.target.value } : r)),
                        )
                      }
                      className="min-w-0 flex-1 border-0 bg-transparent text-sm focus:outline-none"
                    />
                    <button
                      type="button"
                      aria-label={`Quitar paso ${idx + 1}`}
                      onClick={() => setChecklist((prev) => prev.filter((r) => r._k !== row._k))}
                      className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2">
              <Input
                aria-label="Nuevo paso"
                value={stepDraft}
                maxLength={300}
                placeholder="Añadir un paso y pulsar Enter"
                className="h-10"
                onChange={(e) => setStepDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addStep();
                  }
                }}
              />
              <Button type="button" variant="secondary" size="sm" onClick={addStep}>
                <Plus className="h-3.5 w-3.5" />
                Paso
              </Button>
            </div>
          </div>

          {/* ── Etiquetas ─────────────────────────────────────────────────── */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-zinc-800">
              <Tag className="h-4 w-4 text-zinc-400" />
              Etiquetas
            </p>
            {labels.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {labels.map((l) => (
                  <span
                    key={l}
                    className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-[12px] font-medium text-zinc-700"
                  >
                    #{l}
                    <button
                      type="button"
                      aria-label={`Quitar etiqueta ${l}`}
                      onClick={() => setLabels((prev) => prev.filter((x) => x !== l))}
                      className="text-zinc-400 hover:text-red-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Input
              aria-label="Nueva etiqueta"
              value={labelDraft}
              maxLength={40}
              placeholder="Escribe una etiqueta y pulsa Enter"
              className="h-10"
              onChange={(e) => setLabelDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addLabel();
                }
              }}
            />
          </div>

          {/* ── Paciente (opcional) ───────────────────────────────────────── */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-3">
            {showPatient ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="tc-pname">Paciente</Label>
                  <Input
                    id="tc-pname"
                    className="mt-1.5 h-10"
                    value={patientName}
                    maxLength={160}
                    placeholder="Nombre del paciente"
                    onChange={(e) => setPatientName(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="tc-pphone">Teléfono</Label>
                  <Input
                    id="tc-pphone"
                    className="mt-1.5 h-10"
                    value={patientPhone}
                    maxLength={40}
                    placeholder="+34…"
                    onChange={(e) => setPatientPhone(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowPatient(true)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900"
              >
                <Plus className="h-4 w-4" />
                Vincular un paciente
              </button>
            )}
          </div>

          {/* ── Evidencia ─────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-white px-3.5 py-2.5">
            <span className="flex items-center gap-2 text-sm font-medium text-zinc-700">
              <ShieldCheck className="h-4 w-4 text-brand-500" />
              Exigir evidencia para cerrarla
            </span>
            <Switch
              checked={requiresEvidence}
              onCheckedChange={setRequiresEvidence}
              label="Exigir evidencia"
            />
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-3.5 py-2 text-xs text-red-700">{error}</p>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 border-t border-zinc-100 pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Crear tarea
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
