'use client';

import { mergePatientsAction } from '@/app/(dashboard)/dashboard/agenda/patient-removal-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/cn';
import { AlertTriangle, Check, Combine, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

export interface MergeCandidate {
  patientKey: string;
  name: string;
  /** Ficha de paciente (con nacimiento, anamnesis…) o sólo citas/contacto. */
  isPerson: boolean;
  birthDate: string | null;
  phone: string | null;
  appointments: number;
  notes: number;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Unir fichas duplicadas del mismo paciente.
 *
 * Cada fila se puede elegir como "la que se queda" y se puede dejar fuera si
 * no es la misma persona. Lo que pasa se explica en el propio diálogo antes
 * de confirmar. Sólo administradores; el servidor lo vuelve a comprobar.
 */
export function MergePatientsButton({ candidates }: { candidates: MergeCandidate[] }) {
  const router = useRouter();
  const suggested = React.useMemo(
    () =>
      [...candidates].sort(
        (a, b) =>
          Number(b.isPerson) - Number(a.isPerson) ||
          b.appointments + b.notes - (a.appointments + a.notes),
      )[0]?.patientKey ?? '',
    [candidates],
  );
  const [open, setOpen] = React.useState(false);
  const [keep, setKeep] = React.useState(suggested);
  const [included, setIncluded] = React.useState<Set<string>>(
    () => new Set(candidates.map((c) => c.patientKey)),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function abrir() {
    setKeep(suggested);
    setIncluded(new Set(candidates.map((c) => c.patientKey)));
    setError(null);
    setDone(null);
    setOpen(true);
  }

  const chosen = candidates.filter((c) => included.has(c.patientKey));
  const keepRow = candidates.find((c) => c.patientKey === keep) ?? null;
  const personRow = keepRow?.isPerson ? keepRow : chosen.find((c) => c.isPerson);
  const totals = chosen.reduce(
    (acc, c) => ({ appointments: acc.appointments + c.appointments, notes: acc.notes + c.notes }),
    { appointments: 0, notes: 0 },
  );
  const canMerge = chosen.length >= 2 && keepRow !== null && included.has(keep);

  function toggle(key: string) {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function unir() {
    setError(null);
    startTransition(async () => {
      const result = await mergePatientsAction(
        keep,
        chosen.map((c) => c.patientKey).filter((k) => k !== keep),
      );
      if (result.ok) {
        setDone(
          `Hecho: queda una sola ficha con ${plural(totals.appointments, 'cita', 'citas')} y ${plural(totals.notes, 'nota', 'notas')}.`,
        );
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  if (candidates.length < 2) return null;

  return (
    <>
      <Button variant="soft" size="sm" onClick={abrir} title="Unir fichas duplicadas">
        <Combine className="h-4 w-4" /> Unir
      </Button>
      <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Unir fichas duplicadas</DialogTitle>
            <DialogDescription>
              1. Toca la ficha que se queda. 2. Desmarca la que no sea la misma persona. Todo lo de
              las demás pasa a la que se queda.
            </DialogDescription>
          </DialogHeader>

          {done ? (
            <p className="mt-3 flex items-start gap-2 rounded-[14px] bg-emerald-50 p-3 text-[14px] text-emerald-800">
              <Check className="mt-0.5 h-4 w-4 shrink-0" /> {done}
            </p>
          ) : (
            <div className="mt-3 grid gap-2">
              {candidates.map((c) => {
                const isKeep = keep === c.patientKey;
                const isIn = included.has(c.patientKey);
                return (
                  <div
                    key={c.patientKey}
                    className={cn(
                      'rounded-[14px] p-3 ring-1 ring-(--color-border) transition-colors',
                      isKeep && 'bg-brand-50 ring-2 ring-brand-400',
                      !isIn && 'opacity-55',
                    )}
                  >
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 text-left disabled:cursor-not-allowed"
                      onClick={() => {
                        setKeep(c.patientKey);
                        if (!isIn) toggle(c.patientKey);
                      }}
                      disabled={pending}
                      aria-pressed={isKeep}
                    >
                      <span
                        className={cn(
                          'mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full ring-2',
                          isKeep ? 'bg-brand-600 ring-brand-600' : 'ring-zinc-300',
                        )}
                        aria-hidden
                      >
                        {isKeep && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </span>
                      <span className="min-w-0 flex-1 text-[13px] text-zinc-700">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[15px] font-bold text-zinc-900">{c.name}</span>
                          {isKeep && <Badge tone="brand">Se queda</Badge>}
                          <Badge tone="neutral" size="sm">
                            {c.isPerson ? 'Ficha de paciente' : 'Citas del teléfono'}
                          </Badge>
                        </span>
                        <span className="mt-0.5 block">
                          {[
                            c.birthDate
                              ? `Nacido ${c.birthDate.split('-').reverse().join('/')}`
                              : null,
                            c.phone,
                            plural(c.appointments, 'cita', 'citas'),
                            plural(c.notes, 'nota', 'notas'),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    </button>
                    {!isKeep && (
                      <label className="mt-2 flex cursor-pointer items-center gap-2 pl-7 text-[13px] text-zinc-600">
                        <input
                          type="checkbox"
                          checked={!isIn}
                          onChange={() => toggle(c.patientKey)}
                          disabled={pending}
                        />
                        No es la misma persona (dejarla aparte)
                      </label>
                    )}
                  </div>
                );
              })}

              {canMerge && keepRow && (
                <div className="rounded-[14px] bg-zinc-50 p-3 text-[13px] text-zinc-700">
                  <p className="font-semibold text-zinc-900">Qué va a pasar</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    <li>
                      Queda una sola ficha, <strong>{keepRow.name}</strong>, con{' '}
                      {plural(totals.appointments, 'cita', 'citas')} y{' '}
                      {plural(totals.notes, 'nota', 'notas')}.
                    </li>
                    {personRow && !keepRow.isPerson && (
                      <li>
                        Se conserva la ficha de paciente (nacimiento, anamnesis, tutores y
                        consentimiento) con el nombre y el teléfono que elegiste.
                      </li>
                    )}
                    {personRow && <li>Cobros, facturas y consentimientos también pasan a ella.</li>}
                    <li>Las demás fichas desaparecen de la lista.</li>
                  </ul>
                </div>
              )}
              {chosen.length < 2 && (
                <p className="text-[13px] text-zinc-600">
                  Hacen falta al menos dos fichas marcadas para unir.
                </p>
              )}
              {error && (
                <p className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                </p>
              )}
            </div>
          )}

          <DialogFooter className="mt-4 flex justify-end gap-2">
            {done ? (
              <Button onClick={() => setOpen(false)}>Cerrar</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Cancelar
                </Button>
                <Button onClick={unir} disabled={pending || !canMerge}>
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Combine className="h-4 w-4" />
                  )}
                  Unir {chosen.length} fichas en una
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
