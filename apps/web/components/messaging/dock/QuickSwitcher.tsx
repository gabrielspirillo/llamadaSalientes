'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useMessaging } from '@/components/messaging/MessagingProvider';
import { StatusDot } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { Hash, MessageSquare, Search, User, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';

/* ============================================================================
   Cambio rápido (⌘J / Ctrl+J). Canales y personas por recencia, filtrable,
   navegable con flechas. Enter abre el canal en el dock — o, si ya estás en la
   página completa, cambia de canal ahí mismo.
   ========================================================================== */

type Row =
  | { type: 'channel'; id: string; label: string; hint: string; unread: number; dm: boolean }
  | { type: 'person'; id: string; label: string; hint: string; online: boolean };

function normalize(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      // Rango de marcas diacríticas combinantes: es justo lo que hay que quitar.
      // biome-ignore lint/suspicious/noMisleadingCharacterClass: rango intencional
      .replace(/[\u0300-\u036f]/g, '')
  );
}

/**
 * Sólo el atajo. No consume el contexto de mensajería, así que estar montado
 * de forma permanente en el panel no cuesta nada: el panel de verdad, que sí
 * lee canales y personas, se monta recién al abrirlo.
 */
export function QuickSwitcher() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;
  return <QuickSwitcherPanel onClose={() => setOpen(false)} />;
}

function QuickSwitcherPanel({ onClose }: { onClose: () => void }) {
  const { channels, people, rail, openChannel, openDmWith, ready } = useMessaging();
  const open = true;
  const setOpen = (v: boolean) => {
    if (!v) onClose();
  };
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const onMessagesPage = pathname.startsWith('/dashboard/messages');

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, []);

  const rows = useMemo<Row[]>(() => {
    const meId = rail?.me?.userId ?? null;
    const byRecency = [...channels]
      .filter((c) => !c.archived)
      .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));

    const channelRows: Row[] = byRecency.map((c) => ({
      type: 'channel',
      id: c.id,
      label: c.name,
      hint: c.kind === 'DM' ? 'Directo' : (c.topic ?? 'Canal'),
      unread: c.unreadCount,
      dm: c.kind === 'DM',
    }));

    // Personas sin DM abierto todavía: entran como acción "abrir directo".
    const withDm = new Set(
      channels
        .filter((c) => c.kind === 'DM' && c.counterpartUserId)
        .map((c) => c.counterpartUserId),
    );
    const personRows: Row[] = people
      .filter((p) => p.userId !== meId && !withDm.has(p.userId))
      .map((p) => ({
        type: 'person',
        id: p.userId,
        label: p.name,
        hint: 'Abrir mensaje directo',
        online: (rail?.presence ?? []).some((x) => x.userId === p.userId && x.online),
      }));

    const all = [...channelRows, ...personRows];
    const needle = normalize(q.trim());
    if (!needle) return all.slice(0, 24);
    return all.filter((r) => normalize(r.label).includes(needle)).slice(0, 24);
  }, [channels, people, rail, q]);

  useEffect(() => {
    if (cursor > rows.length - 1) setCursor(Math.max(0, rows.length - 1));
  }, [rows.length, cursor]);

  if (!open || !ready) return null;

  function pick(row: Row | undefined) {
    if (!row) return;
    setOpen(false);
    if (row.type === 'person') {
      void openDmWith(row.id);
      return;
    }
    if (onMessagesPage) router.push(`/dashboard/messages?channel=${row.id}`);
    else openChannel(row.id);
  }

  return (
    // El fondo cierra con el ratón; por teclado ya está Escape en el panel.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape cubre el teclado
    <div
      className="fixed inset-0 z-[80] flex animate-fade-in items-start justify-center bg-[#171429]/40 pt-[12vh] backdrop-blur-md"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[520px] max-w-[94vw] animate-pop overflow-hidden rounded-[26px] border border-white/60 bg-white shadow-[0_40px_90px_-30px_rgba(22,26,25,0.55)]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setOpen(false);
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor((c) => Math.min(rows.length - 1, c + 1));
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((c) => Math.max(0, c - 1));
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            pick(rows[cursor]);
          }
        }}
      >
        <div className="relative flex items-center gap-3 border-b border-[--color-border-subtle] px-5 py-4">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(95,168,150,0.12),transparent_70%)]"
          />
          <Search className="relative h-4 w-4 shrink-0 text-brand-500" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            placeholder="Ir a un canal o a una persona…"
            className="relative flex-1 bg-transparent text-[16px] outline-none placeholder:text-zinc-500"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar"
            className="relative rounded-full p-1.5 text-zinc-400 transition-all hover:rotate-90 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto">
          {rows.length === 0 ? (
            <EmptyState
              icon={<MessageSquare className="h-5 w-5" />}
              title="Sin coincidencias"
              description="Prueba con otro nombre de canal o de compañera."
            />
          ) : (
            <ul className="p-2">
              {rows.map((r, i) => (
                <li key={`${r.type}-${r.id}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => pick(r)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors duration-150',
                      i === cursor ? 'bg-brand-50' : 'hover:bg-zinc-100/70',
                    )}
                  >
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600 ring-1 ring-[--color-border]">
                      {r.type === 'person' ? (
                        <User className="h-4 w-4" />
                      ) : r.dm ? (
                        <MessageSquare className="h-4 w-4" />
                      ) : (
                        <Hash className="h-4 w-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-zinc-800">
                        {r.label}
                      </span>
                      <span className="block truncate text-xs text-zinc-500">{r.hint}</span>
                    </span>
                    {r.type === 'person' && r.online && <StatusDot tone="success" />}
                    {r.type === 'channel' && r.unread > 0 && (
                      <span className="inline-flex min-w-[20px] shrink-0 items-center justify-center rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">
                        {r.unread > 99 ? '99+' : r.unread}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[--color-border-subtle] bg-[#fbfaff] px-5 py-2.5 text-[12px] text-zinc-500">
          <span>↑↓ para moverte · ↵ para abrir · Esc para cerrar</span>
          <span className="tabular-nums">⌘J</span>
        </div>
      </div>
    </div>
  );
}
