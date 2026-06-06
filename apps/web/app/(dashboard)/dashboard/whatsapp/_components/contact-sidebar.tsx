'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import {
  addTagToConversation,
  assignConversation,
  createTag,
  removeTagFromConversation,
  setAiEnabled,
} from '../inbox-actions';

interface Tag {
  id: string;
  label: string;
  color: string;
}

interface Member {
  userId: string;
  email: string;
  role: string;
}

interface Appointment {
  id: string;
  startTime: string | null;
  status: string | null;
  treatment: string | null;
}

interface Props {
  conversationId: string;
  contact: {
    id: string;
    name: string | null;
    phoneE164: string;
    ghlContactId: string | null;
    avatarUrl: string | null;
    createdAt: Date;
  };
  conversation: {
    channel: 'WHATSAPP_CLOUD' | 'WHATSAPP_EVOLUTION' | 'WHATSAPP_TWILIO';
    status: 'ACTIVE' | 'HANDOFF' | 'CLOSED';
    aiEnabled: boolean;
    assignedUserId: string | null;
    lastMsgAt: Date | null;
    humanTakeoverUntil: Date | null;
  };
  appointments: Appointment[];
  tagsAll: Tag[];
  tagsOnConversation: Tag[];
  members: Member[];
  /** Memoria del lead (cross-canal): resumen rolling + hechos. Null si aún no hay. */
  leadMemory?: {
    profileSummary: string | null;
    facts: Record<string, unknown>;
    updatedAt: string;
  } | null;
}

/** Aplana los `facts` de la memoria a pares legibles, salteando vacíos. */
function leadFactEntries(facts: Record<string, unknown>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(facts ?? {})) {
    if (v == null) continue;
    const val = Array.isArray(v) ? v.filter(Boolean).join(', ') : String(v);
    if (!val.trim()) continue;
    out.push([k, val]);
  }
  return out;
}

const channelLabel = (c: Props['conversation']['channel']) =>
  c === 'WHATSAPP_CLOUD' ? 'Cloud API' : c === 'WHATSAPP_TWILIO' ? 'Twilio' : 'Evolution';

export function ContactSidebar({
  conversationId,
  contact,
  conversation,
  appointments,
  tagsAll,
  tagsOnConversation,
  members,
  leadMemory,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // ¿Hay una ventana de takeover del operador vigente? Durante esa ventana la
  // IA está pausada aunque aiEnabled siga en true (retoma sola al expirar).
  const takeoverActive =
    !!conversation.humanTakeoverUntil &&
    new Date(conversation.humanTakeoverUntil).getTime() > Date.now();

  // Estado local optimista para los tags y AI. El toggle refleja el estado
  // EFECTIVO (si la IA realmente va a responder), no solo el flag aiEnabled,
  // para que coincida con la badge "Activa / En manos del operador".
  const [localTags, setLocalTags] = useState<Tag[]>(tagsOnConversation);
  const [aiOn, setAiOn] = useState(conversation.aiEnabled && !takeoverActive);
  const [assignedUserId, setAssignedUserId] = useState<string | null>(
    conversation.assignedUserId,
  );

  // Crear nueva etiqueta inline.
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagLabel, setNewTagLabel] = useState('');
  const [newTagColor, setNewTagColor] = useState('#10b981');

  const tagPool = tagsAll.filter((t) => !localTags.some((lt) => lt.id === t.id));

  const handleToggleAi = () => {
    setError(null);
    const next = !aiOn;
    setAiOn(next);
    startTransition(async () => {
      const res = await setAiEnabled({ conversationId, enabled: next });
      if (!res.success) {
        setAiOn(!next);
        setError(res.error);
      }
    });
  };

  const handleAssign = (userId: string | null) => {
    setError(null);
    const prev = assignedUserId;
    setAssignedUserId(userId);
    startTransition(async () => {
      const res = await assignConversation({ conversationId, userId });
      if (!res.success) {
        setAssignedUserId(prev);
        setError(res.error);
      }
    });
  };

  const handleAddTag = (tag: Tag) => {
    setError(null);
    setLocalTags((prev) => [...prev, tag]);
    startTransition(async () => {
      const res = await addTagToConversation({ conversationId, tagId: tag.id });
      if (!res.success) {
        setLocalTags((prev) => prev.filter((t) => t.id !== tag.id));
        setError(res.error);
      }
    });
  };

  const handleRemoveTag = (tagId: string) => {
    setError(null);
    const removed = localTags.find((t) => t.id === tagId);
    setLocalTags((prev) => prev.filter((t) => t.id !== tagId));
    startTransition(async () => {
      const res = await removeTagFromConversation({ conversationId, tagId });
      if (!res.success && removed) {
        setLocalTags((prev) => [...prev, removed]);
        setError(res.error);
      }
    });
  };

  const handleCreateTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagLabel.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await createTag({ label: newTagLabel.trim(), color: newTagColor });
      if (!res.success) {
        setError(res.error);
        return;
      }
      const newTag: Tag = { id: res.data.id, label: newTagLabel.trim(), color: newTagColor };
      setLocalTags((prev) => [...prev, newTag]);
      // Asignar de inmediato a la conversación.
      const assignRes = await addTagToConversation({ conversationId, tagId: newTag.id });
      if (!assignRes.success) setError(assignRes.error);
      setNewTagLabel('');
      setNewTagOpen(false);
    });
  };

  const assignedMember = members.find((m) => m.userId === assignedUserId);

  return (
    <aside className="hidden lg:flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-zinc-200 bg-zinc-50/50 p-4">
      {error && (
        <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {/* Contacto */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="flex items-center gap-3">
          {contact.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={contact.avatarUrl}
              alt="avatar"
              className="h-12 w-12 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-base font-semibold text-emerald-700">
              {(contact.name ?? contact.phoneE164).slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900">
              {contact.name ?? 'Sin nombre'}
            </p>
            <p className="text-xs text-zinc-500">{contact.phoneE164}</p>
          </div>
        </div>
        <Link
          href={`/dashboard/whatsapp/contacts/${contact.id}`}
          className="mt-3 inline-flex w-full items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Ver detalles del contacto
        </Link>
        <dl className="mt-4 space-y-2 text-xs">
          <div className="flex justify-between">
            <dt className="text-zinc-500">Canal</dt>
            <dd className="font-medium text-zinc-700">{channelLabel(conversation.channel)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">Estado</dt>
            <dd className="font-medium text-zinc-700">{conversation.status}</dd>
          </div>
          {conversation.humanTakeoverUntil && conversation.status === 'HANDOFF' && (
            <div className="flex justify-between">
              <dt className="text-zinc-500">Takeover hasta</dt>
              <dd className="font-medium text-zinc-700">
                {new Date(conversation.humanTakeoverUntil).toLocaleTimeString()}
              </dd>
            </div>
          )}
          {conversation.lastMsgAt && (
            <div className="flex justify-between">
              <dt className="text-zinc-500">Último mensaje</dt>
              <dd className="font-medium text-zinc-700">
                {new Date(conversation.lastMsgAt).toLocaleString()}
              </dd>
            </div>
          )}
          {contact.ghlContactId && (
            <div className="flex justify-between">
              <dt className="text-zinc-500">GHL ID</dt>
              <dd className="truncate font-mono text-[10px] text-zinc-700">
                {contact.ghlContactId}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Memoria del lead (cross-canal: WhatsApp + llamadas in/out) */}
      {leadMemory?.profileSummary ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-zinc-900">Memoria del lead</p>
            <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
              multicanal
            </span>
          </div>
          <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-zinc-700">
            {leadMemory.profileSummary}
          </p>
          {leadFactEntries(leadMemory.facts).length > 0 && (
            <dl className="mt-2 space-y-0.5 border-t border-indigo-100 pt-2">
              {leadFactEntries(leadMemory.facts).map(([k, v]) => (
                <div key={k} className="flex gap-1 text-[11px]">
                  <dt className="font-medium capitalize text-zinc-500">{k.replace(/_/g, ' ')}:</dt>
                  <dd className="text-zinc-700">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-2 text-[10px] text-zinc-400">
            Actualizada {new Date(leadMemory.updatedAt).toLocaleString()}
          </p>
        </div>
      ) : null}

      {/* Citas */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <p className="text-sm font-semibold text-zinc-900">Citas</p>
        {appointments.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500">
            {contact.ghlContactId
              ? 'Sin citas registradas.'
              : 'Aún no hay link con el CRM.'}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {appointments.slice(0, 5).map((a) => (
              <li key={a.id} className="rounded-lg bg-zinc-50 px-2 py-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-zinc-800">
                    {a.treatment ?? 'Cita'}
                  </span>
                  {a.status && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${apptStatusClass(a.status)}`}
                    >
                      {a.status}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[10px] text-zinc-500">
                  {a.startTime ? new Date(a.startTime).toLocaleString() : 'Sin fecha'}
                </p>
              </li>
            ))}
            {appointments.length > 5 && (
              <Link
                href={`/dashboard/whatsapp/contacts/${contact.id}`}
                className="inline-block text-[11px] text-emerald-600 hover:text-emerald-700"
              >
                Ver todas ({appointments.length})
              </Link>
            )}
          </ul>
        )}
      </div>

      {/* Agente IA */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-900">Agente Virtual</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {aiOn
                ? 'El agente IA responde a todos los mensajes.'
                : takeoverActive
                  ? 'En manos del operador. La IA retoma sola al terminar la ventana, o activala ahora.'
                  : 'El agente IA está pausado.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggleAi}
            disabled={pending}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              aiOn ? 'bg-emerald-500' : 'bg-zinc-300'
            }`}
            aria-pressed={aiOn}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                aiOn ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Asignación */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <p className="text-sm font-semibold text-zinc-900">Asignar a</p>
        <select
          value={assignedUserId ?? ''}
          onChange={(e) => handleAssign(e.target.value || null)}
          disabled={pending}
          className="mt-2 w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm focus:border-zinc-400 focus:outline-none disabled:bg-zinc-50"
        >
          <option value="">Sin asignar</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.email} ({m.role})
            </option>
          ))}
        </select>
        {assignedMember && (
          <p className="mt-2 text-[11px] text-zinc-500">
            Asignado a <span className="font-medium text-zinc-700">{assignedMember.email}</span>
          </p>
        )}
      </div>

      {/* Etiquetas */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-zinc-900">Etiquetas</p>
          <button
            type="button"
            onClick={() => setNewTagOpen((v) => !v)}
            className="text-xs text-emerald-600 hover:text-emerald-700"
          >
            {newTagOpen ? 'Cancelar' : '+ Nueva'}
          </button>
        </div>

        {newTagOpen && (
          <form onSubmit={handleCreateTag} className="mt-3 space-y-2">
            <input
              type="text"
              value={newTagLabel}
              onChange={(e) => setNewTagLabel(e.target.value)}
              placeholder="Nombre de la etiqueta"
              maxLength={40}
              className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs focus:border-zinc-400 focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newTagColor}
                onChange={(e) => setNewTagColor(e.target.value)}
                className="h-7 w-10 cursor-pointer rounded border border-zinc-200"
              />
              <button
                type="submit"
                disabled={pending || !newTagLabel.trim()}
                className="ml-auto rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Crear y aplicar
              </button>
            </div>
          </form>
        )}

        {localTags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {localTags.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                style={{ backgroundColor: t.color }}
              >
                {t.label}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(t.id)}
                  disabled={pending}
                  className="rounded-full hover:bg-black/20"
                  aria-label={`Quitar ${t.label}`}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <line x1="6" y1="6" x2="18" y2="18" />
                    <line x1="6" y1="18" x2="18" y2="6" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}

        {tagPool.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700">
              Añadir existente ({tagPool.length})
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tagPool.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleAddTag(t)}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] hover:opacity-80 disabled:opacity-40"
                  style={{ borderColor: t.color, color: t.color }}
                >
                  + {t.label}
                </button>
              ))}
            </div>
          </details>
        )}

        {localTags.length === 0 && tagPool.length === 0 && !newTagOpen && (
          <p className="mt-3 text-xs text-zinc-400">
            No hay etiquetas todavía. Crea la primera arriba.
          </p>
        )}
      </div>
    </aside>
  );
}

function apptStatusClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('confirm')) return 'bg-emerald-100 text-emerald-700';
  if (s.includes('show') && !s.includes('no')) return 'bg-blue-100 text-blue-700';
  if (s.includes('no')) return 'bg-red-100 text-red-700';
  if (s.includes('cancel')) return 'bg-zinc-200 text-zinc-700';
  return 'bg-zinc-100 text-zinc-700';
}
