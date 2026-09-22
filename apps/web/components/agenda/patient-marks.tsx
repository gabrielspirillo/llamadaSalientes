'use client';

import { setPatientMarksAction } from '@/app/(dashboard)/dashboard/agenda/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  PRIORITY_LABELS,
  type PriorityLevel,
  SESSION_BEHAVIOR_FACES,
  SESSION_BEHAVIOR_LABELS,
  type SessionBehavior,
} from '@/lib/care-profile/policy';
import { cn } from '@/lib/cn';
import { AlertTriangle, Check, Loader2, ShieldAlert, Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * Las marcas de la ficha: prioritario (con motivo, que leen los asistentes),
 * la estrella de "dejó reseña en Google" y cómo se portó la última vez.
 *
 * La prioridad que se PINTA sale de la edad y de la marca a la vez
 * (`priorityLevel`); aquí sólo se edita la marca manual.
 */
export function PatientMarks({
  patientId,
  priorityFlag,
  priorityReason,
  googleReview,
  needsHumanReview = false,
  reviewReason = null,
  computedPriority,
  lastBehavior,
  canEdit,
}: {
  patientId: string;
  priorityFlag: boolean;
  priorityReason: string | null;
  googleReview: boolean;
  /** Aviso médico que dejó un asistente: hasta que alguien lo valore, no se da cita. */
  needsHumanReview?: boolean;
  reviewReason?: string | null;
  computedPriority: PriorityLevel;
  lastBehavior: SessionBehavior | null;
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

  function submit(extra: { needsHumanReview?: boolean } = {}) {
    setError(null);
    startTransition(async () => {
      const result = await setPatientMarksAction(patientId, {
        priorityFlag: flag,
        priorityReason: reason,
        googleReview: review,
        ...extra,
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
    <div className="grid gap-3">
      {needsHumanReview && (
        <div className="flex flex-wrap items-start gap-2 rounded-[14px] border border-amber-200 bg-amber-50/80 p-3 text-[13px] text-amber-900">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Pendiente de valorar por una persona</p>
            <p>
              {reviewReason ?? 'Aviso dejado por el asistente.'} Mientras tanto, los asistentes no
              le dan cita.
            </p>
          </div>
          {canEdit && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => submit({ needsHumanReview: false })}
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Ya valorado
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {computedPriority !== 'NORMAL' && (
          <Badge tone={computedPriority === 'VERY_HIGH' ? 'danger' : 'warn'}>
            {PRIORITY_LABELS[computedPriority]}
          </Badge>
        )}
        {lastBehavior && (
          <Badge tone="neutral" title="Última sesión">
            <span aria-hidden>{SESSION_BEHAVIOR_FACES[lastBehavior]}</span> Última sesión:{' '}
            {SESSION_BEHAVIOR_LABELS[lastBehavior].toLowerCase()}
          </Badge>
        )}
        <button
          type="button"
          aria-pressed={review}
          disabled={!canEdit}
          onClick={() => {
            setReview((v) => !v);
            setSaved(false);
          }}
          title={review ? 'Dejó reseña en Google' : 'Marcar si dejó reseña en Google'}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 transition-colors disabled:cursor-default',
            review
              ? 'bg-amber-100/80 text-amber-700 ring-amber-200'
              : 'bg-white text-zinc-500 ring-[--color-border] enabled:hover:bg-amber-50',
          )}
        >
          <Star className={cn('h-3.5 w-3.5', review && 'fill-amber-500 text-amber-500')} />
          {review ? 'Reseña en Google' : 'Sin reseña'}
        </button>
      </div>

      <label className="flex items-start gap-2 text-[13px] text-zinc-700">
        <input
          type="checkbox"
          checked={flag}
          disabled={!canEdit}
          onChange={(e) => {
            setFlag(e.target.checked);
            setSaved(false);
          }}
          className="mt-0.5"
        />
        <span>
          <span className="font-semibold">Prioritario</span>: los asistentes le ofrecen el primer
          hueco y avisan a recepción si no lo hay.
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

      {error && (
        <p className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {canEdit && (dirty || saved) && (
        <div className="flex items-center justify-end gap-2">
          {saved && !dirty && (
            <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-600">
              <Check className="h-4 w-4" /> Guardado
            </span>
          )}
          {dirty && (
            <Button size="sm" onClick={() => submit()} disabled={pending}>
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Guardar marcas
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
