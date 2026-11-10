'use client';

import { CheckCircle2, MousePointerClick, Sparkles } from 'lucide-react';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  type Announcement,
  type AnnouncementVisual,
  matchesPath,
} from '@/lib/announcements/catalog';

/** Margen tras cargar la página: el aviso no tapa lo primero que se ve. */
const FIRST_DELAY_MS = 2500;

/**
 * Novedades del panel: un pop-up por aviso pendiente, de uno en uno, en la
 * página que le toca. "Entendido" no lo vuelve a mostrar; "Recordar más
 * tarde" o cerrarlo lo vuelve a mostrar en unas horas. No sale encima de otro
 * diálogo abierto ni con la pestaña en segundo plano.
 */
export function AnnouncementCenter() {
  const pathname = usePathname();
  const [items, setItems] = React.useState<Announcement[] | null>(null);
  const [current, setCurrent] = React.useState<Announcement | null>(null);

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      fetch('/api/announcements', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { announcements?: Announcement[] } | null) => setItems(d?.announcements ?? []))
        .catch(() => setItems([]));
    }, FIRST_DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  React.useEffect(() => {
    if (!items?.length || current) return;
    const next = items.find((a) => matchesPath(a, pathname));
    if (!next) return;
    if (document.visibilityState !== 'visible') return;
    if (document.querySelector('[role="dialog"]')) return;
    setCurrent(next);
  }, [items, pathname, current]);

  function act(action: 'dismiss' | 'snooze') {
    if (!current) return;
    const id = current.id;
    fetch('/api/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
      keepalive: true,
    }).catch(() => undefined);
    setItems((xs) => xs?.filter((x) => x.id !== id) ?? null);
    setCurrent(null);
  }

  return (
    <Dialog open={Boolean(current)} onOpenChange={(open) => !open && act('snooze')}>
      {current && (
        <DialogContent className="max-w-md overflow-hidden p-0 sm:p-0">
          {current.visual && <Visual kind={current.visual} />}
          <div className="flex flex-col gap-4 p-6 sm:p-7">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-[12px] font-bold uppercase tracking-[0.12em] text-brand-700">
              <Sparkles className="h-3.5 w-3.5" />
              {current.eyebrow}
            </span>
            <div className="flex flex-col gap-2">
              <DialogTitle className="text-balance text-[22px] font-bold leading-tight text-zinc-900">
                {current.title}
              </DialogTitle>
              <DialogDescription className="text-[15px] leading-relaxed text-zinc-600">
                {current.body}
              </DialogDescription>
            </div>
            {current.bullets?.length ? (
              <ul className="flex flex-col gap-2">
                {current.bullets.map((b) => (
                  <li key={b} className="flex gap-2.5 text-[14px] leading-snug text-zinc-700">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => act('snooze')}>
                Recordar más tarde
              </Button>
              <Button onClick={() => act('dismiss')} autoFocus>
                Entendido
              </Button>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

function Visual({ kind }: { kind: AnnouncementVisual }) {
  if (kind === 'status-completed') return <StatusCompletedVisual />;
  return null;
}

/** Una cita de ejemplo con los botones de estado y «Atendida» señalado. */
function StatusCompletedVisual() {
  const states: { label: string; active?: boolean }[] = [
    { label: 'Agendada' },
    { label: 'Confirmada' },
    { label: 'Atendida', active: true },
    { label: 'No se presentó' },
  ];
  return (
    <div
      aria-hidden
      className="relative overflow-hidden bg-[linear-gradient(135deg,#e7f3ef_0%,#f1f7f4_55%,#f6f5fb_100%)] px-6 pb-6 pt-12 sm:pt-7"
    >
      <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(95,168,150,0.28),transparent_70%)] animate-float-slow" />
      <div className="relative mx-auto max-w-[320px] animate-pop rounded-[18px] border border-white/80 bg-white p-4 shadow-[0_18px_40px_-22px_rgba(20,33,29,0.45)]">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-zinc-500">Hoy · 17:30</p>
            <p className="truncate text-[15px] font-bold text-zinc-900">Sesión de fisioterapia</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
            Terminada
          </span>
        </div>
        <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-zinc-400">Estado</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {states.map((s) =>
            s.active ? (
              <span key={s.label} className="relative">
                <span className="absolute inset-0 rounded-full bg-brand-400/40 animate-pulse-ring" />
                <span className="relative inline-flex items-center rounded-full bg-brand-600 px-3 py-1 text-[12px] font-semibold text-white shadow-[0_6px_16px_-6px_rgba(55,118,106,0.8)]">
                  {s.label}
                </span>
                <MousePointerClick className="absolute -bottom-4 -right-3 h-5 w-5 rotate-[-8deg] text-zinc-800 drop-shadow" />
              </span>
            ) : (
              <span
                key={s.label}
                className="rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-zinc-500 ring-1 ring-(--color-border)"
              >
                {s.label}
              </span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
