'use client';

import { formatDue } from '@/components/tasks/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { CATEGORY_META, PRIORITY_META, STATUS_META, type TaskStatus } from '@/lib/tasks/constants';
import { parseQuickTask } from '@/lib/tasks/quick-parse';
import type { TaskMember } from '@/lib/tasks/types';
import { Loader2, Plus, Sparkles, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

/**
 * Alta rápida en una línea.
 *
 * Nadie va a rellenar nueve campos entre paciente y paciente. Se escribe
 * "Llamar a María mañana 10:30 #paciente !alta @lucia" y la vista previa
 * muestra exactamente qué se va a crear antes de apretar enter.
 */
/** Minúsculas y sin tildes, para comparar nombres como los escribe la gente. */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function QuickAdd({
  members,
  status,
  onCreated,
  onCancel,
  autoFocus = true,
}: {
  members: TaskMember[];
  status: TaskStatus;
  onCreated: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseQuickTask(value), [value]);

  const matchedMembers = useMemo(() => {
    if (parsed.assigneeHints.length === 0) return [];
    return parsed.assigneeHints
      .map((hint) => {
        // Sin quitar tildes, escribir "@lucia" no encontraba a "Lucía" y la
        // tarea se creaba sin responsable, en silencio.
        const needle = fold(hint);
        return members.find(
          (m) => fold(m.name).startsWith(needle) || fold(m.email).startsWith(needle),
        );
      })
      .filter((m): m is TaskMember => !!m);
  }, [parsed.assigneeHints, members]);

  // Avisar cuando se escribió un @alguien que no existe, en vez de ignorarlo.
  const unmatchedHints = useMemo(
    () =>
      parsed.assigneeHints.filter(
        (hint) =>
          !members.some(
            (m) => fold(m.name).startsWith(fold(hint)) || fold(m.email).startsWith(fold(hint)),
          ),
      ),
    [parsed.assigneeHints, members],
  );

  const submit = async () => {
    const title = parsed.title.trim();
    if (!title) {
      setError('Escribe al menos qué hay que hacer');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title,
          status,
          category: parsed.category ?? undefined,
          priority: parsed.priority ?? undefined,
          dueAt: parsed.dueAt ? parsed.dueAt.toISOString() : undefined,
          dueAllDay: parsed.dueAllDay,
          labels: parsed.labels.length > 0 ? parsed.labels : undefined,
          assigneeUserIds:
            matchedMembers.length > 0 ? matchedMembers.map((m) => m.userId) : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'No se pudo crear la tarea');
      setValue('');
      onCreated();
      inputRef.current?.focus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const hasPreview =
    parsed.category ||
    parsed.priority ||
    parsed.dueAt ||
    matchedMembers.length > 0 ||
    parsed.labels.length > 0;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex items-center gap-2"
      >
        <Plus className="h-4 w-4 shrink-0 text-zinc-500" />
        <input
          ref={inputRef}
          // biome-ignore lint/a11y/noAutofocus: el usuario abrió el alta rápida a propósito
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel?.();
          }}
          placeholder="Llamar a María mañana 10:30 #paciente !alta @lucia"
          className="min-w-0 flex-1 border-0 bg-transparent text-sm placeholder:text-zinc-500 focus:outline-none"
        />
        <span className="hidden shrink-0 text-[10px] text-zinc-500 sm:inline">
          en {STATUS_META[status].label}
        </span>
        <Button type="submit" size="sm" disabled={busy || !parsed.title.trim()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Crear'}
        </Button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancelar"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </form>

      {hasPreview && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-zinc-100 pt-2">
          <Sparkles className="h-3 w-3 text-zinc-300" />
          {parsed.category && (
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
                CATEGORY_META[parsed.category].chip,
              )}
            >
              {CATEGORY_META[parsed.category].label}
            </span>
          )}
          {parsed.priority && (
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
                PRIORITY_META[parsed.priority].chip,
              )}
            >
              {PRIORITY_META[parsed.priority].label}
            </span>
          )}
          {parsed.dueAt && (
            <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600">
              vence {formatDue(parsed.dueAt.toISOString(), parsed.dueAllDay)}
            </span>
          )}
          {matchedMembers.map((m) => (
            <span
              key={m.userId}
              className="inline-flex items-center rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-white"
            >
              {m.name}
            </span>
          ))}
          {parsed.labels.map((l) => (
            <span
              key={l}
              className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600"
            >
              #{l}
            </span>
          ))}
        </div>
      )}

      {unmatchedHints.length > 0 && (
        <p className="mt-2 text-xs text-amber-700">
          No encuentro a {unmatchedHints.map((h) => `@${h}`).join(', ')} en el equipo. La tarea se
          creará sin esa persona asignada.
        </p>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
