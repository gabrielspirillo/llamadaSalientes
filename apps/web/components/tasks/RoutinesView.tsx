'use client';

import { EmptyState } from '@/components/tasks/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  CATEGORY_META,
  PRIORITY_META,
  TRIGGER_META,
  type TaskPriority,
} from '@/lib/tasks/constants';
import { describeRecurrence } from '@/lib/tasks/recurrence';
import type { TaskAutomationRuleDTO, TaskMember, TaskTemplateDTO } from '@/lib/tasks/types';
import { Bot, ChevronDown, Loader2, Play, Repeat, ShieldCheck, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

/**
 * "Rutinas" reúne las dos formas que tiene el tablero de llenarse solo:
 * las plantillas recurrentes (el SOP de la clínica) y las reglas que
 * reaccionan a eventos. Están juntas porque responden a la misma pregunta:
 * ¿de dónde salen las tareas que nadie escribió?
 */
export function RoutinesView({
  templates,
  rules,
  members,
  isAdmin,
  onRefresh,
}: {
  templates: TaskTemplateDTO[];
  rules: TaskAutomationRuleDTO[];
  members: TaskMember[];
  isAdmin: boolean;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const call = async (fn: () => Promise<Response>, okMessage?: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fn();
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'No se pudo completar la acción');
      if (okMessage) setNote(okMessage);
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runNow = () =>
    call(
      () => fetch('/api/tasks/run-routines', { method: 'POST' }),
      'Listo: ya se han creado las tareas que tocaban.',
    );

  const seedCatalog = () =>
    call(
      () =>
        fetch('/api/tasks/templates', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'seed' }),
        }),
      'Catálogo de rutinas de clínica dental instalado.',
    );

  const patchTemplate = (id: string, body: Record<string, unknown>) =>
    call(() =>
      fetch(`/api/tasks/templates/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  const patchRule = (id: string, body: Record<string, unknown>) =>
    call(() =>
      fetch(`/api/tasks/automations/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  return (
    <div className="space-y-8">
      {(error || note) && (
        <p
          className={cn(
            'rounded-xl px-3.5 py-2 text-xs',
            error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700',
          )}
        >
          {error ?? note}
        </p>
      )}

      {/* ── Rutinas recurrentes ─────────────────────────────────────────── */}
      <section>
        <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
              <Repeat className="h-4 w-4 text-zinc-400" />
              Rutinas de la clínica
            </h2>
            <p className="mt-0.5 max-w-2xl text-xs text-zinc-500">
              El estándar escrito. Si el proceso solo vive en la cabeza de alguien, no es un
              proceso: aquí cada rutina se crea sola el día que toca, con su lista de comprobación.
            </p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={runNow} disabled={busy}>
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Generar ahora
              </Button>
            </div>
          )}
        </header>

        {templates.length === 0 ? (
          <EmptyState
            title="Todavía no hay rutinas"
            description="Instala el catálogo de clínica dental: apertura, reunión diaria, cierre, esterilización, control biológico, avisos de revisión, presupuestos, pacientes que no acuden, stock, indicadores, RGPD, validación del autoclave y revisión de los equipos de rayos."
            action={
              isAdmin ? (
                <Button size="sm" onClick={seedCatalog} disabled={busy}>
                  <Sparkles className="h-3.5 w-3.5" />
                  Instalar catálogo
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {templates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                members={members}
                isAdmin={isAdmin}
                busy={busy}
                onPatch={patchTemplate}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Seguimiento postoperatorio ──────────────────────────────────── */}
      <PostOpSection isAdmin={isAdmin} />

      {/* ── Automatizaciones ────────────────────────────────────────────── */}
      <section>
        <header className="mb-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
            <Bot className="h-4 w-4 text-zinc-400" />
            Tareas que se crean solas
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-zinc-500">
            Si alguien tiene que acordarse de crear la tarea, la tarea no se crea. Estas reglas
            escuchan lo que ya pasa en la clínica —llamadas, citas, recordatorios, WhatsApp— y dejan
            la tarea creada, con responsable y fecha límite.
          </p>
        </header>

        <div className="space-y-2">
          {rules.map((r) => (
            <RuleRow
              key={r.id}
              rule={r}
              members={members}
              isAdmin={isAdmin}
              busy={busy}
              onPatch={patchRule}
            />
          ))}
          {rules.length === 0 && (
            <EmptyState
              title="Sin reglas cargadas"
              description="Se crean solas al entrar en la sección. Recarga la página si no aparecen."
            />
          )}
        </div>
      </section>
    </div>
  );
}

function TemplateCard({
  template,
  members,
  isAdmin,
  busy,
  onPatch,
}: {
  template: TaskTemplateDTO;
  members: TaskMember[];
  isAdmin: boolean;
  busy: boolean;
  onPatch: (id: string, body: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const meta = CATEGORY_META[template.category];
  const rate =
    template.stats.generated > 0
      ? Math.round((template.stats.completed / template.stats.generated) * 100)
      : null;

  return (
    <article
      className={cn(
        'rounded-2xl border bg-white p-4 transition-opacity',
        template.enabled ? 'border-zinc-200/80' : 'border-zinc-200/60 opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', meta.dot)} />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-zinc-900">{template.name}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{template.description}</p>
          <p className="mt-1.5 text-[11px] font-medium text-zinc-600">
            {describeRecurrence(
              {
                freq: template.recurrenceFreq,
                interval: template.recurrenceInterval,
                weekdays: template.recurrenceWeekdays,
                monthDay: template.recurrenceMonthDay,
                month: template.recurrenceMonth,
                anchorDateKey: template.lastMaterializedOn ?? '2026-01-01',
              },
              template.dueTime,
            )}
            {template.requiresEvidence && (
              <span className="ml-2 inline-flex items-center gap-1 text-brand-600">
                <ShieldCheck className="h-3 w-3" /> exige evidencia
              </span>
            )}
          </p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={template.enabled}
            disabled={!isAdmin || busy}
            onChange={(e) => onPatch(template.id, { enabled: e.target.checked })}
            className="h-4 w-4 rounded border-zinc-300 accent-zinc-900"
          />
          <span className="sr-only">Activar rutina</span>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-zinc-500">
        <span className="tabular-nums">
          {template.items.length} paso{template.items.length === 1 ? '' : 's'}
        </span>
        <span className="tabular-nums">
          {template.stats.generated} generada{template.stats.generated === 1 ? '' : 's'} en 30 días
        </span>
        {rate !== null && (
          <span
            className={cn(
              'font-semibold tabular-nums',
              rate >= 80 ? 'text-emerald-600' : rate >= 50 ? 'text-amber-600' : 'text-red-600',
            )}
          >
            {rate}% cumplida
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 font-medium text-zinc-600 hover:text-zinc-900"
        >
          {open ? 'Ocultar' : 'Ver los pasos'}
          <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-zinc-100 pt-3">
          <ol className="space-y-1">
            {template.items.map((i, idx) => (
              <li key={i.id} className="flex gap-2 text-xs text-zinc-600">
                <span className="tabular-nums text-zinc-400">{idx + 1}.</span>
                {i.content}
              </li>
            ))}
            {template.items.length === 0 && (
              <li className="text-xs text-zinc-400">Sin pasos definidos.</li>
            )}
          </ol>

          {isAdmin && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  Hora
                </span>
                <input
                  type="time"
                  defaultValue={template.dueTime}
                  disabled={busy}
                  onBlur={(e) => {
                    if (e.target.value && e.target.value !== template.dueTime) {
                      onPatch(template.id, { dueTime: e.target.value });
                    }
                  }}
                  className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  Responsable por defecto
                </span>
                <select
                  value={template.defaultAssigneeUserId ?? ''}
                  disabled={busy}
                  onChange={(e) =>
                    onPatch(template.id, { defaultAssigneeUserId: e.target.value || null })
                  }
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm"
                >
                  <option value="">Sin asignar</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function RuleRow({
  rule,
  members,
  isAdmin,
  busy,
  onPatch,
}: {
  rule: TaskAutomationRuleDTO;
  members: TaskMember[];
  isAdmin: boolean;
  busy: boolean;
  onPatch: (id: string, body: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const meta = TRIGGER_META[rule.trigger];

  return (
    <article
      className={cn(
        'rounded-2xl border bg-white p-4 transition-opacity',
        rule.enabled ? 'border-zinc-200/80' : 'border-zinc-200/60 opacity-60',
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-900">{meta.label}</h3>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
                PRIORITY_META[rule.priority as TaskPriority].chip,
              )}
            >
              {PRIORITY_META[rule.priority as TaskPriority].label}
            </span>
            <span className="text-[11px] text-zinc-400">
              vence en {formatOffset(rule.dueOffsetMinutes)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            <span className="font-medium text-zinc-600">Cuándo:</span> {meta.when}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            <span className="font-medium text-zinc-600">Por qué:</span> {meta.why}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-[11px] tabular-nums text-zinc-400">
            {rule.generatedLast30d} en 30 días
          </span>
          <input
            type="checkbox"
            checked={rule.enabled}
            disabled={!isAdmin || busy}
            onChange={(e) => onPatch(rule.id, { enabled: e.target.checked })}
            aria-label={`Activar regla ${meta.label}`}
            className="h-4 w-4 rounded border-zinc-300 accent-zinc-900"
          />
        </div>
      </div>

      {isAdmin && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-zinc-600 hover:text-zinc-900"
          >
            {open ? 'Ocultar ajustes' : 'Ajustar'}
            <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
          </button>

          {open && (
            <div className="mt-3 grid gap-3 border-t border-zinc-100 pt-3 sm:grid-cols-3">
              <label className="block sm:col-span-3">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  Título de la tarea
                </span>
                <input
                  defaultValue={rule.titleTemplate}
                  disabled={busy}
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value !== rule.titleTemplate) {
                      onPatch(rule.id, { titleTemplate: e.target.value.trim() });
                    }
                  }}
                  className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm"
                />
                <span className="mt-1 block text-[10px] text-zinc-400">
                  Variables: {'{{patientName}}'} {'{{phone}}'} {'{{date}}'} {'{{treatment}}'}
                </span>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  Plazo (minutos)
                </span>
                <input
                  type="number"
                  min={5}
                  max={20160}
                  defaultValue={rule.dueOffsetMinutes}
                  disabled={busy}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v !== rule.dueOffsetMinutes) {
                      onPatch(rule.id, { dueOffsetMinutes: Math.max(5, Math.min(20160, v)) });
                    }
                  }}
                  className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  Se asigna a
                </span>
                <select
                  value={rule.assigneeUserId ?? ''}
                  disabled={busy}
                  onChange={(e) => onPatch(rule.id, { assigneeUserId: e.target.value || null })}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm"
                >
                  <option value="">Cualquiera del equipo</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              {rule.trigger === 'PATIENT_INACTIVE' && (
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    Meses sin venir
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    defaultValue={Number(rule.params.inactiveMonths ?? 12)}
                    disabled={busy}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) {
                        onPatch(rule.id, {
                          params: { ...rule.params, inactiveMonths: Math.max(1, Math.min(60, v)) },
                        });
                      }
                    }}
                    className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm"
                  />
                </label>
              )}
            </div>
          )}
        </>
      )}
    </article>
  );
}

interface PostOpTreatment {
  id: string;
  name: string;
  postOpFollowUp: boolean;
  postOpFollowUpHours: number;
}

/**
 * Qué tratamientos merecen llamada postoperatoria.
 *
 * Sin esta lista la regla no puede existir: llamar después de una extracción
 * o una cirugía cambia la percepción del paciente; llamar después de una
 * limpieza es ruido que quema al equipo y al paciente.
 */
function PostOpSection({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<PostOpTreatment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks/postop-treatments', { cache: 'no-store' });
      const data = (await res.json()) as { treatments?: PostOpTreatment[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'No se pudieron cargar los tratamientos');
      setItems(data.treatments ?? []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (t: PostOpTreatment, value: boolean) => {
    setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, postOpFollowUp: value } : x)));
    try {
      const res = await fetch('/api/tasks/postop-treatments', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ treatmentId: t.id, postOpFollowUp: value }),
      });
      if (!res.ok) throw new Error('No se pudo guardar');
    } catch (err) {
      setError((err as Error).message);
      void load();
    }
  };

  return (
    <section>
      <header className="mb-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
          <ShieldCheck className="h-4 w-4 text-zinc-400" />
          Tratamientos con llamada postoperatoria
        </h2>
        <p className="mt-0.5 max-w-2xl text-xs text-zinc-500">
          Marca los tratamientos que justifican una llamada a las 24-48 h. Cuando se complete una
          cita de uno de ellos, la tarea se crea sola. Los que no marques no generan nada.
        </p>
      </header>

      {error && (
        <p className="mb-2 rounded-xl bg-red-50 px-3.5 py-2 text-xs text-red-700">{error}</p>
      )}

      {loading ? (
        <p className="text-xs text-zinc-400">Cargando tratamientos…</p>
      ) : items.length === 0 ? (
        <EmptyState
          title="Sin tratamientos cargados"
          description="Carga los tratamientos de la clínica en la sección Tratamientos y vuelve aquí para elegir cuáles llevan seguimiento."
        />
      ) : (
        <ul className="flex flex-wrap gap-2">
          {items.map((t) => (
            <li key={t.id}>
              <label
                className={cn(
                  'inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  t.postOpFollowUp
                    ? 'border-zinc-900 bg-zinc-900 text-white'
                    : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300',
                  !isAdmin && 'cursor-not-allowed opacity-70',
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={t.postOpFollowUp}
                  disabled={!isAdmin}
                  onChange={(e) => void toggle(t, e.target.checked)}
                />
                {t.name}
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatOffset(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) {
    const h = Math.round(minutes / 60);
    return `${h} h`;
  }
  const d = Math.round(minutes / 1440);
  return `${d} día${d === 1 ? '' : 's'}`;
}
