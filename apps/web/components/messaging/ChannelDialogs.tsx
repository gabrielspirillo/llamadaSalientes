'use client';

import { Check, Hash, Lock, Search, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Callout } from '@/components/ui/feedback';
import { Input, InputWithIcon, Label, Textarea } from '@/components/ui/input';
import { Avatar } from '@/components/ui/stat';
import { cn } from '@/lib/cn';
import type { ImChannelDTO, ImPerson } from '@/lib/messaging/types';

/* ============================================================================
   Crear canal y gestionar sus miembros.

   Hasta ahora los dos endpoints existían y no había forma de llamarlos desde
   la interfaz: una clínica se quedaba con los tres canales sembrados y no
   podía abrir uno para caja o para el turno de tarde.

   Los cuerpos se arman OMITIENDO los campos vacíos en vez de mandarlos como
   null o cadena vacía. Es la lección del bug que tumbó los envíos: en el borde
   cliente/servidor los tipos no viajan, así que lo que no se manda no puede
   ser rechazado.
   ========================================================================== */

type Kind = 'PUBLIC' | 'PRIVATE' | 'GROUP';

/** Selector de personas reutilizado por los dos diálogos. */
function PeoplePicker({
  people,
  selected,
  onToggle,
  excludeIds,
  emptyLabel = 'No queda nadie por añadir.',
}: {
  people: ImPerson[];
  selected: Set<string>;
  onToggle: (userId: string) => void;
  excludeIds?: Set<string>;
  emptyLabel?: string;
}) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();

  const list = useMemo(
    () =>
      people
        .filter((p) => !excludeIds?.has(p.userId))
        .filter(
          (p) =>
            !needle ||
            p.name.toLowerCase().includes(needle) ||
            p.email.toLowerCase().includes(needle),
        ),
    [people, excludeIds, needle],
  );

  return (
    <div className="space-y-2">
      <InputWithIcon
        icon={<Search className="h-4 w-4" />}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar a alguien del equipo"
        aria-label="Buscar a alguien del equipo"
        className="h-10"
      />
      <ul className="max-h-52 space-y-0.5 overflow-y-auto rounded-2xl border border-[--color-border] bg-white/70 p-1.5">
        {list.length === 0 && (
          <li className="px-2 py-6 text-center text-[13px] text-zinc-500">{emptyLabel}</li>
        )}
        {list.map((p) => {
          const on = selected.has(p.userId);
          return (
            <li key={p.userId}>
              <button
                type="button"
                onClick={() => onToggle(p.userId)}
                aria-pressed={on}
                className={cn(
                  'press flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors',
                  on ? 'bg-brand-50' : 'hover:bg-zinc-100',
                )}
              >
                <Avatar name={p.name} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-zinc-800">
                    {p.name}
                  </span>
                  <span className="block truncate text-[11.5px] text-zinc-500">{p.email}</span>
                </span>
                <span
                  className={cn(
                    'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all',
                    on
                      ? 'animate-pop border-brand-500 bg-brand-500 text-white'
                      : 'border-zinc-300 text-transparent',
                  )}
                >
                  <Check className="h-3 w-3" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function NewChannelDialog({
  open,
  onOpenChange,
  people,
  me,
  canCreatePublic,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  people: ImPerson[];
  me: ImPerson | null;
  /** Un canal público lo ve toda la clínica: eso lo decide un admin. */
  canCreatePublic: boolean;
  onCreated: (channelId: string) => void;
}) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [kind, setKind] = useState<Kind>(canCreatePublic ? 'PUBLIC' : 'PRIVATE');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cada apertura arranca limpia: reabrir con lo de la vez anterior confunde.
  useEffect(() => {
    if (!open) return;
    setName('');
    setTopic('');
    setKind(canCreatePublic ? 'PUBLIC' : 'PRIVATE');
    setSelected(new Set());
    setError(null);
    setBusy(false);
  }, [open, canCreatePublic]);

  const toggle = (userId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  const submit = async () => {
    const clean = name.trim();
    if (!clean) {
      setError('Ponle un nombre al canal.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Se omiten los campos vacíos en vez de mandarlos vacíos.
      const payload: Record<string, unknown> = { kind, name: clean };
      const cleanTopic = topic.trim();
      if (cleanTopic) payload.topic = cleanTopic;
      if (selected.size > 0) payload.memberUserIds = Array.from(selected);

      const res = await fetch('/api/messages/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? 'No se pudo crear el canal');
      onCreated(data.id);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const others = useMemo(() => people.filter((p) => p.userId !== me?.userId), [people, me]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo canal</DialogTitle>
          <DialogDescription>
            Un sitio para un tema que se repite: la caja del día, el turno de tarde, el box 2.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="im-channel-name">Nombre</Label>
            <Input
              id="im-channel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Caja"
              maxLength={80}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="im-channel-topic">De qué se habla aquí (opcional)</Label>
            <Textarea
              id="im-channel-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Arqueo diario, incidencias con el datáfono y cierres de caja."
              maxLength={300}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Quién lo ve</Label>
            <div className="grid grid-cols-2 gap-2">
              <KindOption
                icon={<Hash className="h-4 w-4" />}
                title="Toda la clínica"
                detail="Cualquiera entra y lo encuentra."
                active={kind === 'PUBLIC'}
                disabled={!canCreatePublic}
                disabledHint="Solo un administrador"
                onClick={() => setKind('PUBLIC')}
              />
              <KindOption
                icon={<Lock className="h-4 w-4" />}
                title="Solo invitados"
                detail="No aparece para el resto."
                active={kind === 'PRIVATE'}
                onClick={() => setKind('PRIVATE')}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>
              Miembros{' '}
              <span className="font-normal text-zinc-500">
                {kind === 'PUBLIC'
                  ? '· en un canal público entra todo el equipo'
                  : selected.size > 0
                    ? `· ${selected.size} seleccionados`
                    : '· tú siempre entras'}
              </span>
            </Label>
            <PeoplePicker
              people={others}
              selected={selected}
              onToggle={toggle}
              emptyLabel="No hay más gente en la clínica."
            />
          </div>

          {error && <Callout tone="danger">{error}</Callout>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy ? 'Creando…' : 'Crear canal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KindOption({
  icon,
  title,
  detail,
  active,
  disabled,
  disabledHint,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  active: boolean;
  disabled?: boolean;
  disabledHint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'press rounded-2xl border p-3 text-left transition-all',
        active
          ? 'border-brand-300 bg-brand-50 shadow-[var(--shadow-soft)]'
          : 'border-[--color-border] bg-white/70 hover:bg-zinc-50',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span className={cn('mb-1 inline-flex', active ? 'text-brand-700' : 'text-zinc-500')}>
        {icon}
      </span>
      <span className="block text-[13.5px] font-semibold text-zinc-800">{title}</span>
      <span className="block text-[11.5px] text-zinc-500">
        {disabled ? (disabledHint ?? detail) : detail}
      </span>
    </button>
  );
}

export function ChannelMembersDialog({
  open,
  onOpenChange,
  channel,
  people,
  me,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: ImChannelDTO | null;
  people: ImPerson[];
  me: ImPerson | null;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPending(new Set());
    setError(null);
    setBusy(false);
  }, [open, channel?.id]);

  const memberIds = useMemo(() => new Set(channel?.memberIds ?? []), [channel?.memberIds]);
  const members = useMemo(() => people.filter((p) => memberIds.has(p.userId)), [people, memberIds]);

  const call = async (body: Record<string, string[]>) => {
    if (!channel) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/messages/channels/${channel.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'No se pudo actualizar');
      }
      onChanged();
      setPending(new Set());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (userId: string) =>
    setPending((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  if (!channel) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Quién está en {channel.name}</DialogTitle>
          <DialogDescription>
            {channel.kind === 'PUBLIC'
              ? 'Es un canal abierto: lo ve toda la clínica.'
              : 'Solo entra quien esté en esta lista.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              Dentro <span className="font-normal text-zinc-500">· {members.length}</span>
            </Label>
            <ul className="max-h-44 space-y-0.5 overflow-y-auto rounded-2xl border border-[--color-border] bg-white/70 p-1.5">
              {members.length === 0 && (
                <li className="px-2 py-6 text-center text-[13px] text-zinc-500">
                  Sin miembros cargados.
                </li>
              )}
              {members.map((p) => (
                <li
                  key={p.userId}
                  className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-zinc-100"
                >
                  <Avatar name={p.name} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-zinc-800">
                      {p.name}
                      {p.userId === me?.userId && (
                        <span className="ml-1 text-[11.5px] font-normal text-zinc-500">(tú)</span>
                      )}
                    </span>
                    <span className="block truncate text-[11.5px] text-zinc-500">{p.email}</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void call({ remove: [p.userId] })}
                    aria-label={`Quitar a ${p.name} del canal`}
                    className="press inline-flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-1.5">
            <Label>Añadir</Label>
            <PeoplePicker
              people={people}
              selected={pending}
              onToggle={toggle}
              excludeIds={memberIds}
              emptyLabel="Ya está todo el equipo en el canal."
            />
          </div>

          {error && <Callout tone="danger">{error}</Callout>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cerrar
          </Button>
          <Button
            onClick={() => void call({ add: Array.from(pending) })}
            disabled={busy || pending.size === 0}
          >
            <Users className="h-4 w-4" />
            {busy ? 'Guardando…' : `Añadir ${pending.size > 0 ? pending.size : ''}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
