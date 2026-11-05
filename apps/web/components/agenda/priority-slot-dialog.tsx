'use client';

import {
  cancelPriorityRequestAction,
  createPriorityRequestAction,
} from '@/app/(dashboard)/dashboard/agenda/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label, Select } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { BellRing, CalendarCheck2, Check, Loader2, MessageCircle, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

export interface ActivePriorityRequest {
  id: string;
  fromDay: string;
  untilDay: string;
  professionalName: string | null;
  note: string | null;
}

const STEPS = [
  {
    icon: BellRing,
    title: 'Se libera un hueco',
    text: 'Alguien cancela y el hueco queda libre.',
  },
  {
    icon: MessageCircle,
    title: 'Le escribimos primero',
    text: 'Esta familia recibe el WhatsApp antes que nadie y tiene 45 minutos para contestar.',
  },
  {
    icon: CalendarCheck2,
    title: 'Si acepta, cita dada',
    text: 'Se le crea la cita y le llega la confirmación de siempre. La prioridad se desactiva sola.',
  },
] as const;

/**
 * "Si se libera un hueco, que sea para este paciente". Un clic: queda activa
 * hasta que tenga la cita o se desactive. Va antes que quien quiere adelantar
 * y antes que la lista de espera.
 */
export function PrioritySlotButton({
  patientId,
  patientName,
  todayKey,
  professionals,
  active,
}: {
  patientId: string;
  patientName: string;
  todayKey: string;
  professionals: { id: string; fullName: string }[];
  active: ActivePriorityRequest | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [professionalId, setProfessionalId] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const router = useRouter();

  function activate() {
    start(async () => {
      setError(null);
      const r = await createPriorityRequestAction({
        patientId,
        fromDay: todayKey,
        untilDay: todayKey,
        professionalId: professionalId || null,
        openEnded: true,
      });
      if (r.ok) {
        setOpen(false);
        router.refresh();
      } else setError(r.error);
    });
  }

  function deactivate() {
    if (!active) return;
    start(async () => {
      setError(null);
      const r = await cancelPriorityRequestAction(active.id, patientId);
      if (r.ok) {
        setOpen(false);
        router.refresh();
      } else setError(r.error);
    });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={active ? 'success' : 'secondary'}
        onClick={() => setOpen(true)}
        title="Que sea el primero en recibir un hueco que se libere"
      >
        {active ? <Check className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
        <span className="hidden sm:inline">{active ? 'Prioridad activa' : 'Prioridad'}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[460px] overflow-hidden border-0 p-0 sm:p-0 [&>button]:text-white/80 [&>button]:hover:bg-white/10 [&>button]:hover:text-white">
          {/* Cabecera oscura, el mismo lenguaje que el resto de bloques destacados */}
          <div className="relative overflow-hidden bg-[linear-gradient(140deg,#14211d_0%,#1d3a33_55%,#2b5a4d_100%)] px-6 pt-6 pb-5 text-white">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full bg-emerald-300/20 blur-3xl"
            />
            <DialogHeader className="relative mb-0 text-left">
              <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/12 ring-1 ring-white/20">
                <Zap className="h-5 w-5 text-emerald-200" />
              </span>
              <DialogTitle className="text-[19px] font-extrabold tracking-tight text-white">
                Prioridad para el próximo hueco
              </DialogTitle>
              <DialogDescription className="mt-1 text-[13.5px] leading-relaxed text-emerald-50/75">
                {patientName} será la primera familia a la que ofrezcamos cualquier hueco que se
                libere en la agenda.
              </DialogDescription>
            </DialogHeader>
            {active && (
              <span className="relative mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-300/15 px-3 py-1 text-[12px] font-semibold text-emerald-100 ring-1 ring-emerald-200/30">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                Activa
                {active.professionalName ? ` · con ${active.professionalName}` : ''}
              </span>
            )}
          </div>

          <div className="px-6 py-5">
            <ol className="space-y-3.5">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-3">
                  <span className="relative flex flex-col items-center">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                      <s.icon className="h-4 w-4" />
                    </span>
                    {i < STEPS.length - 1 && (
                      <span aria-hidden className="mt-1 w-px flex-1 bg-(--color-border)" />
                    )}
                  </span>
                  <span className="min-w-0 pb-1">
                    <span className="block text-[14px] font-semibold text-zinc-900">{s.title}</span>
                    <span className="block text-[13px] leading-relaxed text-zinc-600">
                      {s.text}
                    </span>
                  </span>
                </li>
              ))}
            </ol>

            {!active && professionals.length > 1 && (
              <div className="mt-5 grid gap-1.5">
                <Label htmlFor="prio-prof">Con quién</Label>
                <Select
                  id="prio-prof"
                  value={professionalId}
                  onChange={(e) => setProfessionalId(e.target.value)}
                >
                  <option value="">Cualquier profesional</option>
                  {professionals.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            {error && (
              <p className="mt-4 rounded-[12px] bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
                {error}
              </p>
            )}
          </div>

          <div
            className={cn(
              'flex items-center gap-2 border-t border-(--color-border-subtle) bg-zinc-50/70 px-6 py-4',
              active ? 'justify-between' : 'justify-end',
            )}
          >
            {active ? (
              <>
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Cerrar
                </Button>
                <Button variant="danger" onClick={deactivate} disabled={pending}>
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Desactivar prioridad
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Cancelar
                </Button>
                <Button onClick={activate} disabled={pending}>
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4" />
                  )}
                  Activar prioridad
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
