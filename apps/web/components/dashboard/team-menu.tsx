'use client';

import { useMessaging } from '@/components/messaging/MessagingProvider';
import { Avatar } from '@/components/ui/stat';
import { cn } from '@/lib/cn';
import { Check, ListTodo, Loader2, MessageSquare, UserPlus, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

/* ============================================================================
   Pila de avatares del equipo, ahora accionable. Antes solo enlazaba a
   /dashboard/team; ahora al pulsarla abre un panel con cada compañera y dos
   cosas que hacer sin cambiar de pantalla: escribirle o asignarle una tarea.

   La identidad sale de la lista interna de mensajería (`people`), que trae el
   users.id que necesitan el DM y el alta de tarea. Las fotos vienen de Clerk
   (endpoint de avatares) y se cruzan por clerkUserId. Si no hay equipo, el
   panel invita a sumarlo.
   ========================================================================== */

type TeamPhoto = { id: string; userId: string | null; name: string; imageUrl: string | null };

// Etiqueta del rol, tolerante al prefijo `org:` que pone Clerk. Se resuelve
// aquí (función pura) en vez de importar la de tareas, que es `server-only` y
// rompería este componente de cliente en el build.
function roleLabel(raw: string): string {
  const v = raw.replace(/^org:/, '');
  if (v === 'admin') return 'Admin';
  if (v === 'viewer') return 'Lector';
  return 'Operador';
}

export function TeamMenu() {
  const { people, rail, isOnline } = useMessaging();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<Map<string, string>>(new Map());
  const rootRef = useRef<HTMLDivElement>(null);

  const meId = rail?.me?.userId ?? null;
  const team = useMemo(
    () =>
      people
        .filter((p) => p.userId !== meId)
        .sort((a, b) => {
          const oa = isOnline(a.userId) ? 0 : 1;
          const ob = isOnline(b.userId) ? 0 : 1;
          return oa - ob || a.name.localeCompare(b.name, 'es');
        }),
    [people, meId, isOnline],
  );

  // Fotos de Clerk, cruzadas por clerkUserId. Best-effort: si falla, avatares
  // con iniciales.
  useEffect(() => {
    let alive = true;
    fetch('/api/team/avatars')
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d: { members?: TeamPhoto[] }) => {
        if (!alive) return;
        const map = new Map<string, string>();
        for (const m of d.members ?? []) {
          if (m.userId && m.imageUrl) map.set(m.userId, m.imageUrl);
        }
        setPhotos(map);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Sin lista interna todavía (mensajería no lista o equipo de una persona):
  // no dibujamos la pila. El botón de invitar vive dentro del panel.
  if (team.length === 0) return null;

  const shown = team.slice(0, 4);
  const rest = team.length - shown.length;

  const openDm = async (userId: string) => {
    try {
      const res = await fetch('/api/messages/channels/dm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      setOpen(false);
      router.push(data.id ? `/dashboard/messages?channel=${data.id}` : '/dashboard/messages');
    } catch {
      router.push('/dashboard/messages');
    }
  };

  return (
    <div ref={rootRef} className="relative mr-1 hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Equipo de la clínica"
        aria-expanded={open}
        className={cn(
          'flex items-center rounded-full py-1 pl-1 pr-2 transition-colors duration-300',
          open ? 'bg-zinc-100' : 'hover:bg-zinc-100',
        )}
      >
        {shown.map((m, i) => (
          <span
            key={m.userId}
            className="-ml-2.5 transition-transform duration-300 first:ml-0 group-hover:-translate-y-1"
            style={{ zIndex: shown.length - i }}
          >
            <Avatar name={m.name} src={photos.get(m.userId) ?? undefined} size={34} />
          </span>
        ))}
        {rest > 0 && (
          <span className="-ml-2.5 inline-flex h-[34px] w-[34px] items-center justify-center rounded-full bg-brand-100 text-[12px] font-bold text-brand-700 ring-2 ring-white">
            +{rest}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[300px] animate-fade-down overflow-hidden rounded-[20px] border border-white/60 bg-white/95 shadow-[0_30px_70px_-28px_rgba(20,33,29,0.6)] backdrop-blur-2xl">
          <div className="flex items-center justify-between border-b border-[--color-border-subtle] px-4 py-3">
            <span className="inline-flex items-center gap-2 text-[13px] font-bold tracking-tight text-zinc-900">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                <Users className="h-3.5 w-3.5" />
              </span>
              Equipo
            </span>
            <span className="text-[12px] font-semibold text-zinc-400">
              {team.length} {team.length === 1 ? 'persona' : 'personas'}
            </span>
          </div>

          <ul className="max-h-[360px] overflow-y-auto p-1.5">
            {team.map((m) => (
              <TeamRow
                key={m.userId}
                userId={m.userId}
                name={m.name}
                role={roleLabel(m.role)}
                online={isOnline(m.userId)}
                photo={photos.get(m.userId) ?? undefined}
                onMessage={() => openDm(m.userId)}
              />
            ))}
          </ul>

          <Link
            href="/dashboard/team"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-t border-[--color-border-subtle] px-4 py-3 text-[13px] font-semibold text-brand-700 transition-colors hover:bg-brand-50"
          >
            <UserPlus className="h-4 w-4" />
            Invitar a alguien al equipo
          </Link>
        </div>
      )}
    </div>
  );
}

function TeamRow({
  userId,
  name,
  role,
  online,
  photo,
  onMessage,
}: {
  userId: string;
  name: string;
  role: string;
  online: boolean;
  photo?: string;
  onMessage: () => void;
}) {
  const [taskOpen, setTaskOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (taskOpen) inputRef.current?.focus();
  }, [taskOpen]);

  const createTask = async () => {
    const t = title.trim();
    if (!t) return;
    setState('saving');
    setError(null);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: t, assigneeUserIds: [userId], priority: 'MEDIUM' }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          res.status === 403
            ? 'Tu rol no permite crear tareas.'
            : (body.error ?? 'No se pudo crear la tarea.'),
        );
      }
      setState('done');
      setTitle('');
      setTimeout(() => {
        setTaskOpen(false);
        setState('idle');
      }, 1200);
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : 'Error');
    }
  };

  return (
    <li className="rounded-[14px] px-1.5 py-1 transition-colors hover:bg-zinc-50">
      <div className="flex items-center gap-2.5">
        <span className="relative shrink-0">
          <Avatar name={name} src={photo} size={34} />
          {online && (
            <span
              aria-hidden
              className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white"
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-zinc-800">{name}</span>
          <span className="block truncate text-[12px] text-zinc-400">
            {online ? 'En línea' : role}
          </span>
        </span>
        <button
          type="button"
          onClick={onMessage}
          title={`Escribir a ${name}`}
          aria-label={`Escribir a ${name}`}
          className="press inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-brand-50 hover:text-brand-600"
        >
          <MessageSquare className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setTaskOpen((v) => !v)}
          title={`Asignar una tarea a ${name}`}
          aria-label={`Asignar una tarea a ${name}`}
          className={cn(
            'press inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors',
            taskOpen
              ? 'bg-brand-100 text-brand-700'
              : 'text-zinc-400 hover:bg-brand-50 hover:text-brand-600',
          )}
        >
          <ListTodo className="h-4 w-4" />
        </button>
      </div>

      {taskOpen && (
        <div className="animate-fade-down px-1 pb-1.5 pt-2">
          {state === 'done' ? (
            <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[12px] font-semibold text-emerald-700">
              <Check className="h-3.5 w-3.5" />
              Tarea asignada a {name.split(' ')[0]}
            </p>
          ) : (
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createTask();
                  if (e.key === 'Escape') setTaskOpen(false);
                }}
                placeholder={`Tarea para ${name.split(' ')[0]}…`}
                className="h-9 min-w-0 flex-1 rounded-full border border-[--color-border] bg-white px-3 text-[13px] outline-none transition-colors placeholder:text-zinc-400 focus:border-brand-300"
              />
              <button
                type="button"
                onClick={createTask}
                disabled={!title.trim() || state === 'saving'}
                className="press inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-[linear-gradient(120deg,#37766a,#5fa896)] px-3 text-[13px] font-semibold text-white shadow-[0_8px_18px_-10px_rgba(55,118,106,0.9)] disabled:opacity-40"
              >
                {state === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Crear'}
              </button>
              <button
                type="button"
                onClick={() => setTaskOpen(false)}
                aria-label="Cancelar"
                className="press inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {error && <p className="mt-1.5 px-1 text-[12px] text-rose-600">{error}</p>}
        </div>
      )}
    </li>
  );
}
