'use client';

import { mergePatientsAction } from '@/app/(dashboard)/dashboard/agenda/patient-removal-actions';
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
import { AlertTriangle, Combine, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

export interface MergeCandidate {
  patientKey: string;
  name: string;
  detail: string;
  /** Sólo una ficha de paciente (`pat:`) puede ser la que se queda. */
  canKeep: boolean;
  /** Citas + notas: la que más tiene es la propuesta por defecto. */
  history: number;
}

/**
 * Unir fichas duplicadas del mismo paciente. Se elige la que se queda (por
 * defecto, la que tiene más historia) y el resto se vuelca en ella: citas,
 * notas, cobros, facturas y consentimientos. Sólo administradores; el
 * servidor lo vuelve a comprobar.
 */
export function MergePatientsButton({ candidates }: { candidates: MergeCandidate[] }) {
  const router = useRouter();
  const defaultKeep = React.useMemo(
    () =>
      [...candidates].filter((c) => c.canKeep).sort((a, b) => b.history - a.history)[0]
        ?.patientKey ?? '',
    [candidates],
  );
  const [open, setOpen] = React.useState(false);
  const [keep, setKeep] = React.useState(defaultKeep);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function unir() {
    setError(null);
    startTransition(async () => {
      const result = await mergePatientsAction(
        keep,
        candidates.map((c) => c.patientKey).filter((k) => k !== keep),
      );
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  if (!defaultKeep) return null;

  return (
    <>
      <Button
        variant="soft"
        size="sm"
        onClick={() => {
          setKeep(defaultKeep);
          setError(null);
          setOpen(true);
        }}
        title="Unir fichas duplicadas"
      >
        <Combine className="h-4 w-4" /> Unir
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Unir fichas duplicadas</DialogTitle>
            <DialogDescription>
              Elige la ficha que se queda. Las citas, notas, cobros, facturas y consentimientos de
              las demás pasan a ella y las otras fichas desaparecen.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-3 grid gap-2">
            {candidates.map((c) => (
              <label
                key={c.patientKey}
                className={cn(
                  'flex items-start gap-3 rounded-[14px] p-3 ring-1 ring-(--color-border)',
                  c.canKeep ? 'cursor-pointer' : 'opacity-80',
                  keep === c.patientKey && 'bg-brand-50 ring-2 ring-brand-400',
                )}
              >
                <input
                  type="radio"
                  name="keep"
                  className="mt-1"
                  checked={keep === c.patientKey}
                  disabled={!c.canKeep || pending}
                  onChange={() => setKeep(c.patientKey)}
                />
                <span className="text-[13px] text-zinc-700">
                  <span className="block text-[14px] font-bold text-zinc-900">{c.name}</span>
                  {c.detail}
                  {!c.canKeep && (
                    <span className="block text-zinc-500">Citas sueltas del teléfono</span>
                  )}
                </span>
              </label>
            ))}
            {error && (
              <p className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </p>
            )}
          </div>

          <DialogFooter className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={unir} disabled={pending || !keep}>
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Combine className="h-4 w-4" />
              )}
              Unir en una ficha
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
