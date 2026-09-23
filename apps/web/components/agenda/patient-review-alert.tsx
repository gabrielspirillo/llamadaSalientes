'use client';

import { setPatientMarksAction } from '@/app/(dashboard)/dashboard/agenda/actions';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Check, Loader2, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * El aviso médico que dejó un asistente ("la madre comentó un ingreso
 * reciente"): hasta que una persona lo valore, los asistentes no dan cita.
 * Va debajo de la cabecera, donde no se puede no ver, con el botón que lo
 * cierra.
 */
export function PatientReviewAlert({
  patientId,
  reason,
  priorityFlag,
  priorityReason,
  googleReview,
  canEdit,
}: {
  patientId: string;
  reason: string | null;
  priorityFlag: boolean;
  priorityReason: string | null;
  googleReview: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function resolve() {
    setError(null);
    startTransition(async () => {
      const result = await setPatientMarksAction(patientId, {
        priorityFlag,
        priorityReason: priorityReason ?? '',
        googleReview,
        needsHumanReview: false,
      });
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-wrap items-start gap-2.5 rounded-[14px] border border-amber-200 bg-amber-50 px-3.5 py-3 text-[13px] text-amber-900">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Pendiente de valorar por una persona</p>
        <p>
          {reason ?? 'Aviso dejado por el asistente.'} Mientras tanto, los asistentes no le dan
          cita.
        </p>
        {error && (
          <p className="mt-1 flex items-center gap-1 text-rose-700">
            <AlertTriangle className="h-3.5 w-3.5" /> {error}
          </p>
        )}
      </div>
      {canEdit && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={resolve}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Ya valorado
        </Button>
      )}
    </div>
  );
}
