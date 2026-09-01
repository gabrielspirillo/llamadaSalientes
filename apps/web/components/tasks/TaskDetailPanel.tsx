'use client';

import { Avatar, DueChip } from '@/components/tasks/shared';
import { Button } from '@/components/ui/button';
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
import type { TaskDetailDTO, TaskMember } from '@/lib/tasks/types';
import {
  Archive,
  Bot,
  Check,
  Loader2,
  MessageCircle,
  Phone,
  Plus,
  Repeat,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Panel lateral de detalle. Se abre encima del tablero en vez de navegar:
 * cerrar una tarea no debería costar perder de vista el resto del día.
 */
export function TaskDetailPanel({
  taskId,
  members,
  canEdit,
  onClose,
  onChanged,
}: {
  taskId: string;
  members: TaskMember[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [task, setTask] = useState<TaskDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState('');
  const [comment, setComment] = useState('');
  const [evidence, setEvidence] = useState('');
  const [threadOpen, setThreadOpen] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { cache: 'no-store' });
      const data = (await res.json()) as { task?: TaskDetailDTO; error?: string };
      if (!res.ok || !data.task) throw new Error(data.error ?? 'No se pudo cargar la tarea');
      setTask(data.task);
      setEvidence(data.task.evidenceNote ?? '');
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patch = async (body: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { task?: TaskDetailDTO; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'No se pudo guardar');
      if (data.task) {
        setTask(data.task);
        setEvidence(data.task.evidenceNote ?? '');
      }
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const checklistCall = async (method: 'POST' | 'PATCH' | 'DELETE', body: unknown) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/checklist`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { task?: TaskDetailDTO; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'No se pudo actualizar la lista de comprobación');
      if (data.task) setTask(data.task);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const sendComment = async () => {
    const body = comment.trim();
    if (!body) return;
    setComment('');
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const data = (await res.json()) as { task?: TaskDetailDTO; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'No se pudo comentar');
      if (data.task) setTask(data.task);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('No se pudo archivar');
      onChanged();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  const toggleAssignee = (userId: string) => {
    if (!task) return;
    const next = task.assigneeIds.includes(userId)
      ? task.assigneeIds.filter((id) => id !== userId)
      : [...task.assigneeIds, userId];
    void patch({ assigneeUserIds: next });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Cerrar detalle"
        onClick={onClose}
        className="absolute inset-0 bg-zinc-900/20 backdrop-blur-[1px]"
      />
      <aside className="relative flex h-full w-full max-w-xl flex-col border-l border-zinc-200 bg-white shadow-2xl">
        <header className="flex items-start gap-3 border-b border-zinc-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            {task && (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
                      CATEGORY_META[task.category].chip,
                    )}
                  >
                    {CATEGORY_META[task.category].label}
                  </span>
                  {task.source === 'AUTOMATION' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600">
                      <Bot className="h-3 w-3" /> automática
                    </span>
                  )}
                  {task.source === 'ROUTINE' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600">
                      <Repeat className="h-3 w-3" /> rutina
                    </span>
                  )}
                  {task.requiresEvidence && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
                      <ShieldCheck className="h-3 w-3" /> exige evidencia
                    </span>
                  )}
                </div>
                <textarea
                  ref={titleRef}
                  defaultValue={task.title}
                  readOnly={!canEdit}
                  rows={1}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== task.title) void patch({ title: v });
                  }}
                  className="mt-2 w-full resize-none border-0 p-0 text-lg font-semibold leading-snug tracking-tight text-zinc-900 focus:outline-none focus:ring-0"
                />
              </>
            )}
            {loading && <div className="h-6 w-48 animate-pulse rounded bg-zinc-100" />}
          </div>
          <div className="flex items-center gap-1">
            {saving && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {error && (
          <p className="border-b border-red-100 bg-red-50 px-5 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        {task && (
          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
            {/* ── Estado, prioridad, vencimiento ─────────────────────────── */}
            <section className="grid grid-cols-2 gap-3">
              <Field label="Estado">
                <select
                  value={task.status}
                  disabled={!canEdit}
                  onChange={(e) => void patch({ status: e.target.value as TaskStatus })}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm"
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_META[s].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Prioridad">
                <select
                  value={task.priority}
                  disabled={!canEdit}
                  onChange={(e) => void patch({ priority: e.target.value as TaskPriority })}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm"
                >
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_META[p].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Categoría">
                <select
                  value={task.category}
                  disabled={!canEdit}
                  onChange={(e) => void patch({ category: e.target.value as TaskCategory })}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm"
                >
                  {TASK_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_META[c].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Fecha límite">
                <input
                  type="datetime-local"
                  disabled={!canEdit}
                  value={toLocalInput(task.dueAt)}
                  onChange={(e) =>
                    void patch({
                      dueAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                      dueAllDay: false,
                    })
                  }
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm"
                />
              </Field>
            </section>

            {/* ── Asignados ──────────────────────────────────────────────── */}
            <section>
              <SectionTitle>Responsables</SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {members.map((m) => {
                  const active = task.assigneeIds.includes(m.userId);
                  return (
                    <button
                      key={m.userId}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => toggleAssignee(m.userId)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs transition-colors',
                        active
                          ? 'border-zinc-900 bg-zinc-900 text-white'
                          : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300',
                      )}
                    >
                      <Avatar member={m} size="xs" ring={false} />
                      {m.name}
                    </button>
                  );
                })}
                {members.length === 0 && (
                  <p className="text-xs text-zinc-500">
                    Invita al equipo desde Clínica → Equipo para poder repartir tareas.
                  </p>
                )}
              </div>
            </section>

            {/* ── Descripción ────────────────────────────────────────────── */}
            <section>
              <SectionTitle>Detalle</SectionTitle>
              <textarea
                defaultValue={task.description ?? ''}
                readOnly={!canEdit}
                rows={3}
                placeholder="Qué hay que hacer exactamente y por qué"
                onBlur={(e) => {
                  const v = e.target.value;
                  if (v !== (task.description ?? '')) void patch({ description: v || null });
                }}
                className="w-full resize-y rounded-xl border border-zinc-200 px-3 py-2 text-sm leading-relaxed text-zinc-700 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
              />
            </section>

            {/* ── Contexto del paciente ──────────────────────────────────── */}
            {(task.patientName || task.callId || task.whatsappConversationId) && (
              <section>
                <SectionTitle>Contexto</SectionTitle>
                <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
                  {task.patientName && (
                    <p className="text-sm font-medium text-zinc-800">{task.patientName}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {task.patientPhone && (
                      <a
                        href={`tel:${task.patientPhone}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-300"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        Llamar {task.patientPhone}
                      </a>
                    )}
                    {task.whatsappConversationId && (
                      <Link
                        href="/dashboard/whatsapp"
                        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-300"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        Abrir conversación
                      </Link>
                    )}
                    {task.patientGhlContactId && (
                      <Link
                        href={`/dashboard/contacts/${task.patientGhlContactId}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-300"
                      >
                        Ficha del paciente
                      </Link>
                    )}
                    {task.callId && (
                      <Link
                        href="/dashboard/calls"
                        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-300"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        Ver la llamada
                      </Link>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* ── Checklist ──────────────────────────────────────────────── */}
            <section>
              <SectionTitle>
                Lista de comprobación
                {task.checklistTotal > 0 && (
                  <span className="ml-2 font-normal text-zinc-400 tabular-nums">
                    {task.checklistDone}/{task.checklistTotal}
                  </span>
                )}
              </SectionTitle>
              <ul className="space-y-1">
                {task.checklist.map((item) => (
                  <li key={item.id} className="group flex items-start gap-2 rounded-lg px-1 py-1">
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() =>
                        void checklistCall('PATCH', { itemId: item.id, done: !item.done })
                      }
                      className={cn(
                        'mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                        item.done
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-zinc-300 bg-white hover:border-zinc-400',
                      )}
                      aria-label={item.done ? 'Desmarcar' : 'Marcar como hecho'}
                    >
                      {item.done && <Check className="h-3 w-3" />}
                    </button>
                    <span
                      className={cn(
                        'flex-1 text-sm leading-snug',
                        item.done ? 'text-zinc-400 line-through' : 'text-zinc-700',
                      )}
                    >
                      {item.content}
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => void checklistCall('DELETE', { itemId: item.id })}
                        aria-label="Quitar de la lista"
                        className="opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-zinc-400 hover:text-red-600" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {canEdit && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = newItem.trim();
                    if (!v) return;
                    setNewItem('');
                    void checklistCall('POST', { content: v });
                  }}
                  className="mt-2 flex items-center gap-2"
                >
                  <Plus className="h-3.5 w-3.5 text-zinc-400" />
                  <input
                    value={newItem}
                    onChange={(e) => setNewItem(e.target.value)}
                    placeholder="Añadir paso"
                    className="flex-1 border-0 border-b border-transparent bg-transparent py-1 text-sm placeholder:text-zinc-400 focus:border-zinc-300 focus:outline-none"
                  />
                </form>
              )}
            </section>

            {/* ── Evidencia ──────────────────────────────────────────────── */}
            {task.requiresEvidence && (
              <section>
                <SectionTitle>Evidencia para cerrar</SectionTitle>
                <p className="mb-2 text-xs text-zinc-500">
                  Esta tarea no se puede pasar a "Hecho" sin dejar constancia. Anota el número de
                  ciclo, el importe cuadrado, el resultado del control o lo que corresponda.
                </p>
                <textarea
                  value={evidence}
                  readOnly={!canEdit}
                  rows={2}
                  onChange={(e) => setEvidence(e.target.value)}
                  onBlur={() => {
                    if (evidence !== (task.evidenceNote ?? '')) {
                      void patch({ evidenceNote: evidence || null });
                    }
                  }}
                  className="w-full resize-y rounded-xl border border-brand-200 bg-brand-50/40 px-3 py-2 text-sm text-zinc-700 focus:border-brand-400 focus:outline-none"
                />
              </section>
            )}

            {/* ── Actividad ──────────────────────────────────────────────── */}
            <section>
              <SectionTitle>Actividad</SectionTitle>
              <ul className="space-y-2.5">
                {task.comments.map((c) => (
                  <li key={c.id} className="flex gap-2.5 text-sm">
                    <span
                      className={cn(
                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        c.kind === 'activity' ? 'bg-zinc-300' : 'bg-sky-400',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'leading-snug',
                          c.kind === 'activity' ? 'text-xs text-zinc-500' : 'text-zinc-700',
                        )}
                      >
                        {c.body}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-400">
                        {c.authorName ? `${c.authorName} · ` : ''}
                        {new Date(c.createdAt).toLocaleString('es-ES', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </li>
                ))}
                {task.comments.length === 0 && (
                  <li className="text-xs text-zinc-400">Todavía no ha pasado nada aquí.</li>
                )}
              </ul>
            </section>

            {/* ── Conversación del equipo (módulo Mensajes) ───────────────── */}
            <section>
              <SectionTitle>Conversación</SectionTitle>
              {threadOpen ? (
                <ContextThread contextType="TASK" contextId={task.id} label={task.title} />
              ) : (
                <button
                  type="button"
                  onClick={() => setThreadOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-300"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  Abrir el hilo del equipo
                </button>
              )}
            </section>
          </div>
        )}

        {task && canEdit && (
          <footer className="border-t border-zinc-100 px-5 py-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendComment();
              }}
              className="flex items-center gap-2"
            >
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Escribir un comentario…"
                className="flex-1 rounded-full border border-zinc-200 px-3.5 py-2 text-sm placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
              />
              <Button type="submit" size="icon" variant="primary" aria-label="Comentar">
                <Send className="h-4 w-4" />
              </Button>
              <button
                type="button"
                onClick={() => void archive()}
                aria-label="Archivar tarea"
                title="Archivar tarea"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              >
                <Archive className="h-4 w-4" />
              </button>
            </form>
            {task.dueAt && (
              <div className="mt-2">
                <DueChip dueAt={task.dueAt} allDay={task.dueAllDay} />
              </div>
            )}
          </footer>
        )}
      </aside>
    </div>
  );
}

// ─── Hilo del equipo sobre esta tarea ────────────────────────────────────────
// Autocontenido a propósito: abre (o crea) el canal `CONTEXT` de la tarea y
// monta un hilo mínimo. Si el módulo Mensajes no está disponible todavía,
// muestra el error y el resto del panel sigue funcionando igual.

type ThreadMessage = {
  id: string;
  body: string;
  senderName: string | null;
  senderKind: string;
  createdAt: string;
};

function ContextThread({
  contextType,
  contextId,
  label,
}: {
  contextType: 'TASK' | 'PATIENT';
  contextId: string;
  label: string;
}) {
  const [channelId, setChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const fetchThread = useCallback(async (id: string) => {
    const res = await fetch(`/api/messages/channels/${id}/messages`, { cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as {
      messages?: ThreadMessage[];
      error?: string;
    };
    if (!res.ok) throw new Error(data.error ?? 'No se pudo cargar el hilo');
    return data.messages ?? [];
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setStatus('loading');
      try {
        const res = await fetch('/api/messages/channels/context', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contextType, contextId, label: label.slice(0, 160) }),
        });
        const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
        if (!res.ok || !data.id) throw new Error(data.error ?? 'No se pudo abrir el hilo');
        if (!alive) return;
        setChannelId(data.id);
        const list = await fetchThread(data.id);
        if (!alive) return;
        setMessages(list);
        setStatus('ready');
      } catch (err) {
        if (!alive) return;
        setThreadError((err as Error).message);
        setStatus('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [contextType, contextId, label, fetchThread]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !channelId) return;
    setDraft('');
    setSending(true);
    try {
      const res = await fetch(`/api/messages/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body, clientNonce: `${Date.now()}-${Math.random()}` }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'No se pudo enviar');
      }
      setMessages(await fetchThread(channelId));
      setThreadError(null);
    } catch (err) {
      setThreadError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (status === 'loading') {
    return <div className="h-20 animate-pulse rounded-xl bg-zinc-100" />;
  }
  if (status === 'error') {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {threadError ?? 'El chat interno no está disponible.'}
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white">
      <ul className="max-h-64 space-y-3 overflow-y-auto px-3 py-3">
        {messages.map((m) => (
          <li key={m.id} className="text-sm">
            <p className="text-[11px] font-medium text-zinc-400">
              {m.senderKind === 'USER' ? (m.senderName ?? 'Alguien') : 'Cliniq'} ·{' '}
              {new Date(m.createdAt).toLocaleString('es-ES', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            <p className="whitespace-pre-wrap leading-snug text-zinc-700">{m.body}</p>
          </li>
        ))}
        {messages.length === 0 && (
          <li className="text-xs text-zinc-400">
            Nadie escribió todavía. Lo que se hable acá queda con la tarea.
          </li>
        )}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-center gap-2 border-t border-zinc-100 px-3 py-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escribile al equipo…"
          className="flex-1 rounded-full border border-zinc-200 px-3 py-1.5 text-sm placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
        />
        <Button type="submit" size="icon" variant="primary" disabled={sending} aria-label="Enviar">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
      {threadError && <p className="px-3 pb-2 text-[11px] text-red-600">{threadError}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
      {children}
    </h3>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  // <div> y no <label>: el control lo pasa el consumidor como children y
  // biome no puede verificar la asociación. El <span> hace de título visual.
  return (
    <div className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        {label}
      </span>
      {children}
    </div>
  );
}

/** ISO → valor de <input type="datetime-local"> en hora local del navegador. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
