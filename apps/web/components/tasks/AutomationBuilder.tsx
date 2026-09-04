'use client';

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
  type AutomationCondition,
  type AutomationConditionField,
  type AutomationConditionOp,
  CATEGORY_META,
  CONDITION_FIELD_META,
  CONDITION_OP_META,
  PRIORITY_META,
  TASK_AUTOMATION_TRIGGERS,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TRIGGER_CONDITION_FIELDS,
  TRIGGER_META,
  type TaskAutomationTrigger,
  type TaskCategory,
  type TaskPriority,
} from '@/lib/tasks/constants';
import type { TaskAutomationRuleDTO, TaskMember } from '@/lib/tasks/types';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

/**
 * Constructor de automatizaciones a medida.
 *
 * Sirve para crear una regla nueva sobre uno de los eventos que ya emite el
 * producto y para editar una que la clínica creó. Las de sistema (el catálogo)
 * se afinan con los controles en línea de la fila, no aquí.
 */
export function AutomationBuilder({
  open,
  onOpenChange,
  members,
  rule,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  members: TaskMember[];
  /** Presente = editar; ausente = crear. */
  rule?: TaskAutomationRuleDTO | null;
  onSaved: () => void;
}) {
  const editing = Boolean(rule);

  const [trigger, setTrigger] = useState<TaskAutomationTrigger>(rule?.trigger ?? 'MISSED_CALL');
  const [name, setName] = useState(rule?.name ?? '');
  const [titleTemplate, setTitleTemplate] = useState(
    rule?.titleTemplate ?? 'Llamar a {{patientName}}',
  );
  const [descriptionTemplate, setDescriptionTemplate] = useState(rule?.descriptionTemplate ?? '');
  const [category, setCategory] = useState<TaskCategory>(rule?.category ?? 'PATIENT');
  const [priority, setPriority] = useState<TaskPriority>(rule?.priority ?? 'HIGH');
  const [dueOffsetMinutes, setDueOffsetMinutes] = useState(rule?.dueOffsetMinutes ?? 120);
  const [assigneeUserId, setAssigneeUserId] = useState(rule?.assigneeUserId ?? '');
  const [requiresEvidence, setRequiresEvidence] = useState(rule?.requiresEvidence ?? false);
  // Cada fila lleva una clave local estable (`_k`) para React: las condiciones
  // no tienen id propio y se añaden/quitan del medio.
  const keySeq = useRef(0);
  const mint = () => {
    keySeq.current += 1;
    return `c${keySeq.current}`;
  };
  const [conditions, setConditions] = useState<(AutomationCondition & { _k: string })[]>(() =>
    (rule?.conditions ?? []).map((c) => ({ ...c, _k: mint() })),
  );
  const [checklistText, setChecklistText] = useState((rule?.checklist ?? []).join('\n'));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableFields = TRIGGER_CONDITION_FIELDS[trigger];

  const checklist = useMemo(
    () =>
      checklistText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    [checklistText],
  );

  const changeTrigger = (t: TaskAutomationTrigger) => {
    setTrigger(t);
    // Poda las condiciones sobre campos que este evento no trae.
    const valid = new Set(TRIGGER_CONDITION_FIELDS[t]);
    setConditions((prev) => prev.filter((c) => valid.has(c.field)));
  };

  const addCondition = () => {
    const field = availableFields[0];
    if (!field) return;
    setConditions((prev) => [...prev, { field, op: 'contains', value: '', _k: mint() }]);
  };

  const patchCondition = (idx: number, patch: Partial<AutomationCondition>) => {
    setConditions((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const removeCondition = (idx: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError('Ponle un nombre a la automatización.');
    if (!titleTemplate.trim()) return setError('Falta el título de la tarea que va a crear.');
    // El backend exige valor en todo lo que no sea "tiene valor" / "está vacío".
    for (const c of conditions) {
      if (!CONDITION_OP_META[c.op].needsValue) continue;
      if (!(c.value ?? '').trim()) {
        return setError('Hay una condición sin valor. Rellénala o quítala.');
      }
    }

    const cleanConditions = conditions.map((c) =>
      CONDITION_OP_META[c.op].needsValue
        ? { field: c.field, op: c.op, value: (c.value ?? '').trim() }
        : { field: c.field, op: c.op },
    );

    const body = {
      name: name.trim(),
      titleTemplate: titleTemplate.trim(),
      descriptionTemplate: descriptionTemplate.trim() || null,
      category,
      priority,
      dueOffsetMinutes,
      assigneeUserId: assigneeUserId || null,
      requiresEvidence,
      conditions: cleanConditions,
      checklist,
      ...(editing ? {} : { trigger }),
    };

    setBusy(true);
    try {
      const res = await fetch(
        editing ? `/api/tasks/automations/${rule?.id}` : '/api/tasks/automations',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'No se pudo guardar la automatización');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar automatización' : 'Nueva automatización'}</DialogTitle>
          <DialogDescription>
            Elige un evento de la clínica y define la tarea que se creará sola cuando ocurra.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ab-trigger">Cuando ocurre</Label>
              <Select
                id="ab-trigger"
                className="mt-1.5"
                value={trigger}
                disabled={editing}
                onChange={(e) => changeTrigger(e.target.value as TaskAutomationTrigger)}
              >
                {TASK_AUTOMATION_TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_META[t].label}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-[12px] leading-snug text-zinc-500">
                {TRIGGER_META[trigger].when}.
              </p>
            </div>
            <div>
              <Label htmlFor="ab-name">Nombre</Label>
              <Input
                id="ab-name"
                className="mt-1.5"
                value={name}
                maxLength={120}
                placeholder="Ej: Devolver llamada VIP"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="ab-title">Título de la tarea</Label>
            <Input
              id="ab-title"
              className="mt-1.5"
              value={titleTemplate}
              maxLength={300}
              onChange={(e) => setTitleTemplate(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Variables: {'{{patientName}}'} {'{{phone}}'} {'{{date}}'} {'{{treatment}}'}
            </p>
          </div>

          <div>
            <Label htmlFor="ab-desc">Descripción (opcional)</Label>
            <Textarea
              id="ab-desc"
              className="mt-1.5 min-h-[80px]"
              value={descriptionTemplate}
              maxLength={2000}
              onChange={(e) => setDescriptionTemplate(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="ab-cat">Categoría</Label>
              <Select
                id="ab-cat"
                className="mt-1.5"
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
              <Label htmlFor="ab-prio">Prioridad</Label>
              <Select
                id="ab-prio"
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
              <Label htmlFor="ab-offset">Plazo (min)</Label>
              <Input
                id="ab-offset"
                type="number"
                min={5}
                max={20160}
                className="mt-1.5"
                value={dueOffsetMinutes}
                onChange={(e) =>
                  setDueOffsetMinutes(Math.max(5, Math.min(20160, Number(e.target.value) || 5)))
                }
              />
            </div>
          </div>

          <div>
            <Label htmlFor="ab-assignee">Se asigna a</Label>
            <Select
              id="ab-assignee"
              className="mt-1.5"
              value={assigneeUserId}
              onChange={(e) => setAssigneeUserId(e.target.value)}
            >
              <option value="">Cualquiera del equipo</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>

          {/* ── Condiciones ─────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-800">Condiciones</p>
                <p className="text-[12px] text-zinc-500">
                  Sin condiciones, dispara siempre. Con varias, deben cumplirse todas.
                </p>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={addCondition}>
                <Plus className="h-3.5 w-3.5" />
                Añadir
              </Button>
            </div>

            {conditions.length > 0 && (
              <div className="mt-3 space-y-2">
                {conditions.map((c, idx) => {
                  const needsValue = CONDITION_OP_META[c.op].needsValue;
                  return (
                    <div key={c._k} className="flex flex-wrap items-center gap-2">
                      <Select
                        aria-label="Campo"
                        className="h-9 w-auto min-w-[130px] flex-1 px-2.5 text-[13px]"
                        value={c.field}
                        onChange={(e) =>
                          patchCondition(idx, {
                            field: e.target.value as AutomationConditionField,
                          })
                        }
                      >
                        {availableFields.map((f) => (
                          <option key={f} value={f}>
                            {CONDITION_FIELD_META[f].label}
                          </option>
                        ))}
                      </Select>
                      <Select
                        aria-label="Operador"
                        className="h-9 w-auto min-w-[120px] px-2.5 text-[13px]"
                        value={c.op}
                        onChange={(e) =>
                          patchCondition(idx, { op: e.target.value as AutomationConditionOp })
                        }
                      >
                        {(Object.keys(CONDITION_OP_META) as AutomationConditionOp[]).map((op) => (
                          <option key={op} value={op}>
                            {CONDITION_OP_META[op].label}
                          </option>
                        ))}
                      </Select>
                      {needsValue && (
                        <Input
                          aria-label="Valor"
                          className="h-9 flex-1 basis-[120px] px-2.5 text-[13px]"
                          value={c.value ?? ''}
                          maxLength={120}
                          placeholder="valor"
                          onChange={(e) => patchCondition(idx, { value: e.target.value })}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => removeCondition(idx)}
                        aria-label="Quitar condición"
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-white hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Checklist ───────────────────────────────────────────────── */}
          <div>
            <Label htmlFor="ab-checklist">Pasos de la tarea (uno por línea, opcional)</Label>
            <Textarea
              id="ab-checklist"
              className="mt-1.5 min-h-[80px]"
              value={checklistText}
              placeholder={'Confirmar identidad\nAnotar el motivo\nOfrecer nueva cita'}
              onChange={(e) => setChecklistText(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5">
            <span className="text-sm font-medium text-zinc-700">
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

        <div
          className={cn('mt-6 flex items-center justify-end gap-2 border-t border-zinc-100 pt-4')}
        >
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {editing ? 'Guardar cambios' : 'Crear automatización'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
