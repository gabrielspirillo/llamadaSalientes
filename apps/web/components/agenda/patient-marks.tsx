'use client';

import { setPatientMarksAction } from '@/app/(dashboard)/dashboard/agenda/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Switch } from '@/components/ui/input';
import { PRIORITY_LABELS, type PriorityDescription } from '@/lib/care-profile/policy';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * Prioridad y reseña del paciente.
 *
 * La prioridad que se PINTA (aquí y en la cabecera) sale de `describePriority`:
 * edad, marca manual o las dos, y se dice cuál. Así "Prioritario" en la
 * cabecera con la casilla sin marcar deja de parecer un error: es prioritario
 * por edad y la casilla es la marca a mano, que suma un motivo para los
 * asistentes.
 */
export function PatientMarks({
  patientId,
  priorityFlag,
  priorityReason,
  googleReview,
  priority,
  canEdit,
}: {
  patientId: string;
  priorityFlag: boolean;
  priorityReason: string | null;
  googleReview: boolean;
  priority: PriorityDescription;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const [flag, setFlag] = React.useState(priorityFlag);
  const [reason, setReason] = React.useState(priorityReason ?? '');
  const [review, setReview] = React.useState(googleReview);

  const dirty =
    flag !== priorityFlag || review !== googleReview || (flag && reason !== (priorityReason ?? ''));

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await setPatientMarksAction(patientId, {
        priorityFlag: flag,
        priorityReason: reason,
        googleReview: review,
      });
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="grid gap-3.5">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-zinc-700">
        <span className="font-semibold">Prioridad:</span>
        {priority.level === 'NORMAL' ? (
          <span>normal</span>
        ) : (
          <Badge tone={priority.level === 'VERY_HIGH' ? 'danger' : 'warn'}>
            {PRIORITY_LABELS[priority.level]}
          </Badge>
        )}
        {priority.reason && <span className="text-zinc-600">{priority.reason}</span>}
      </div>

      <label className="flex items-start gap-2.5 text-[13px] text-zinc-700">
        <input
          type="checkbox"
          checked={flag}
          disabled={!canEdit}
          onChange={(e) => {
            setFlag(e.target.checked);
            setSaved(false);
          }}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="font-semibold">Marcar prioritario a mano</span>
          {priority.source === 'AGE' || priority.source === 'BOTH'
            ? ' (además de la edad)'
            : ''}
          : los asistentes le ofrecen el primer hueco y avisan a recepción si no lo hay.
        </span>
      </label>
      {flag && (
        <Input
          aria-label="Motivo de la prioridad"
          value={reason}
          disabled={!canEdit}
          onChange={(e) => {
            setReason(e.target.value);
            setSaved(false);
          }}
          placeholder="Motivo (lo lee la IA): prematuro de 30 semanas, bronquiolitis de repetición…"
        />
      )}

      <div className="flex items-center justify-between gap-3 rounded-[14px] border border-(--color-border) px-3 py-2.5">
        <span className="text-[13px] text-zinc-700">
          <span className="font-semibold">Reseña en Google</span>
          <span className="block text-[12px] text-zinc-600">
            {review ? 'La familia ya dejó reseña.' : 'Todavía no la ha dejado.'}
          </span>
        </span>
        <Switch
          checked={review}
          disabled={!canEdit}
          label="Dejó reseña en Google"
          onCheckedChange={(v) => {
            setReview(v);
            setSaved(false);
          }}
        />
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {canEdit && (dirty || saved) && (
        <div className="flex items-center justify-end gap-2">
          {saved && !dirty && (
            <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-700">
              <Check className="h-4 w-4" /> Guardado
            </span>
          )}
          {dirty && (
            <Button size="sm" onClick={submit} disabled={pending}>
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Guardar
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
