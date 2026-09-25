'use client';

import { setPatientMarksAction } from '@/app/(dashboard)/dashboard/agenda/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Switch } from '@/components/ui/input';
import { PRIORITY_LABELS, type PriorityDescription } from '@/lib/care-profile/policy';
import {
  MAX_PRIOR_RED_FLAGS,
  type RedFlagCounts,
  clampPrior,
  describeRedFlags,
  totalRedFlags,
} from '@/lib/care-profile/signals';
import { AlertTriangle, Check, CircleHelp, Flag, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * Marcas del paciente: prioridad, reseña, familia que duda y banderas rojas.
 *
 * Las banderas rojas NO se editan: se cuentan de la agenda (faltas y
 * cancelaciones de la familia). Lo único que se escribe a mano son las de
 * antes de la plataforma, para no perder las que la clínica ya llevaba en sus
 * contactos.
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
  hesitant,
  hesitantNote,
  redFlags,
  canEdit,
}: {
  patientId: string;
  priorityFlag: boolean;
  priorityReason: string | null;
  googleReview: boolean;
  priority: PriorityDescription;
  hesitant: boolean;
  hesitantNote: string | null;
  /** Contadas de la agenda + las de antes (`prior`). */
  redFlags: RedFlagCounts;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const [flag, setFlag] = React.useState(priorityFlag);
  const [reason, setReason] = React.useState(priorityReason ?? '');
  const [review, setReview] = React.useState(googleReview);
  const [doubt, setDoubt] = React.useState(hesitant);
  const [doubtNote, setDoubtNote] = React.useState(hesitantNote ?? '');
  const [prior, setPrior] = React.useState(String(redFlags.prior));
  const priorId = React.useId();

  const priorValue = clampPrior(Number(prior || 0));
  const dirty =
    flag !== priorityFlag ||
    review !== googleReview ||
    (flag && reason !== (priorityReason ?? '')) ||
    doubt !== hesitant ||
    (doubt && doubtNote !== (hesitantNote ?? '')) ||
    priorValue !== redFlags.prior;
  const liveFlags = { ...redFlags, prior: priorValue };
  const flagsTotal = totalRedFlags(liveFlags);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await setPatientMarksAction(patientId, {
        priorityFlag: flag,
        priorityReason: reason,
        googleReview: review,
        hesitant: doubt,
        hesitantNote: doubtNote,
        priorRedFlags: priorValue,
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
          {priority.source === 'AGE' || priority.source === 'BOTH' ? ' (además de la edad)' : ''}:
          los asistentes le ofrecen el primer hueco y avisan a recepción si no lo hay.
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

      <div className="grid gap-2 rounded-[14px] border border-(--color-border) px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-zinc-700">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <CircleHelp className="h-4 w-4 text-sky-600" aria-hidden /> Familia que duda
            </span>
            <span className="block text-[12px] text-zinc-600">
              Pregunta, no coge cita y al tiempo la coge.
            </span>
          </span>
          <Switch
            checked={doubt}
            disabled={!canEdit}
            label="Familia que duda"
            onCheckedChange={(v) => {
              setDoubt(v);
              setSaved(false);
            }}
          />
        </div>
        {doubt && (
          <Input
            aria-label="Nota sobre la duda"
            value={doubtNote}
            disabled={!canEdit}
            maxLength={300}
            onChange={(e) => {
              setDoubtNote(e.target.value);
              setSaved(false);
            }}
            placeholder="Opcional: pidió precios en marzo, lo está pensando…"
          />
        )}
      </div>

      <div className="grid gap-2 rounded-[14px] border border-(--color-border) px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <span className="text-[13px] text-zinc-700">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Flag
                className={
                  flagsTotal > 0 ? 'h-4 w-4 fill-rose-600 text-rose-600' : 'h-4 w-4 text-zinc-400'
                }
                aria-hidden
              />
              Banderas rojas: {flagsTotal}
            </span>
            <span className="block text-[12px] text-zinc-600">
              {flagsTotal > 0 ? describeRedFlags(liveFlags) : 'Ni faltas ni cancelaciones.'} Se
              suman solas con cada falta o cancelación de la familia.
            </span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 text-[12px] text-zinc-700">
          <label htmlFor={priorId}>
            Anteriores a este panel (las que ya teníais en los contactos)
          </label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_PRIOR_RED_FLAGS}
            id={priorId}
            value={prior}
            disabled={!canEdit}
            onChange={(e) => {
              setPrior(e.target.value);
              setSaved(false);
            }}
            className="w-20 text-right"
          />
        </div>
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
