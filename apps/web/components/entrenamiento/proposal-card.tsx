'use client';

import {
  applyProposalAction,
  dismissProposalAction,
} from '@/app/(dashboard)/dashboard/entrenamiento/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import {
  LESSON_KIND_LABEL,
  LESSON_KIND_TONE,
  type LessonProposal,
} from '@/lib/agent-training/model';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { useState, useTransition } from 'react';

/**
 * Una enseñanza propuesta por el entrenador, tal como la ve la clínica.
 *
 * La tarjeta es el punto donde el entrenamiento deja de ser una charla y pasa
 * a cambiar el asistente. Por eso se aprueba de a una y se puede editar el
 * texto antes: lo que se aplica es lo que la clínica leyó, no lo que el
 * modelo dijo.
 */
export function ProposalCard({
  messageId,
  proposal,
  onApplied,
}: {
  messageId: string;
  proposal: LessonProposal;
  onApplied?: () => void;
}) {
  const [estado, setEstado] = useState<'pendiente' | 'aplicada' | 'descartada'>(
    proposal.lessonId ? 'aplicada' : proposal.dismissed ? 'descartada' : 'pendiente',
  );
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(proposal.instruction);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function aplicar() {
    setError(null);
    startTransition(async () => {
      const r = await applyProposalAction({
        messageId,
        ref: proposal.ref,
        kind: proposal.kind,
        title: proposal.title,
        situation: proposal.situation,
        instruction: texto,
      });
      if (r.ok) {
        setEstado('aplicada');
        setEditando(false);
        onApplied?.();
      } else {
        setError(r.error);
      }
    });
  }

  function descartar() {
    setError(null);
    startTransition(async () => {
      const r = await dismissProposalAction({ messageId, ref: proposal.ref });
      if (r.ok) setEstado('descartada');
      else setError(r.error);
    });
  }

  const apagada = estado === 'descartada';

  return (
    <div
      className={`rounded-[18px] border border-(--color-border) bg-white p-4 transition-opacity ${
        apagada ? 'opacity-55' : ''
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={LESSON_KIND_TONE[proposal.kind]} size="sm">
          {LESSON_KIND_LABEL[proposal.kind]}
        </Badge>
        {estado === 'aplicada' && (
          <Badge tone="success" size="sm">
            <Check className="h-3 w-3" /> Aprendida
          </Badge>
        )}
        {apagada && (
          <Badge tone="neutral" size="sm">
            Descartada
          </Badge>
        )}
      </div>

      <p className={`text-[14px] font-semibold text-zinc-900 ${apagada ? 'line-through' : ''}`}>
        {proposal.title}
      </p>
      {proposal.situation && (
        <p className="mt-0.5 text-[12px] text-zinc-500">Cuando {proposal.situation}</p>
      )}

      {editando ? (
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          className="mt-2 min-h-[90px] text-[14px]"
          aria-label="Qué debe hacer el asistente"
        />
      ) : (
        <p className="mt-2 text-[14px] leading-relaxed text-zinc-600">{texto}</p>
      )}

      {error && <p className="mt-2 text-[13px] text-rose-600">{error}</p>}

      {estado === 'pendiente' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={aplicar} disabled={pending || texto.trim().length < 5}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Enseñárselo
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditando((v) => !v)}
            disabled={pending}
          >
            <Pencil className="h-4 w-4" />
            {editando ? 'Listo' : 'Cambiar el texto'}
          </Button>
          <Button size="sm" variant="ghost" onClick={descartar} disabled={pending}>
            <X className="h-4 w-4" />
            Descartar
          </Button>
        </div>
      )}
    </div>
  );
}
