'use client';

import {
  applyDataChangeAction,
  dismissDataChangeAction,
} from '@/app/(dashboard)/dashboard/entrenamiento/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  type DataChangeProposal,
  dataChangeHref,
  describeDataChange,
} from '@/lib/agent-training/data-changes';
import { ArrowRight, Check, ExternalLink, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';

const ENTIDAD: Record<DataChangeProposal['entity'], string> = {
  TREATMENT: 'Tratamiento',
  FAQ: 'Pregunta frecuente',
  CLINIC: 'Datos de la clínica',
};

/**
 * Un cambio en los datos de la clínica, con el antes y el después delante.
 *
 * La diferencia con una enseñanza es que esto toca las tablas que ve todo el
 * panel —y que el paciente acaba oyendo por teléfono—, así que la tarjeta no
 * enseña la frase que propone el modelo: enseña qué valor había y cuál queda.
 * Nadie aprueba un precio que no ha visto.
 */
export function DataChangeCard({
  messageId,
  change,
  onApplied,
}: {
  messageId: string;
  change: DataChangeProposal;
  onApplied?: () => void;
}) {
  const [estado, setEstado] = useState<'pendiente' | 'aplicado' | 'descartado'>(
    change.applied ? 'aplicado' : change.dismissed ? 'descartado' : 'pendiente',
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const destructivo = change.op === 'DELETE' || change.op === 'DEACTIVATE';

  function aplicar() {
    setError(null);
    startTransition(async () => {
      const r = await applyDataChangeAction({ messageId, ref: change.ref });
      if (r.ok) {
        setEstado('aplicado');
        onApplied?.();
      } else {
        setError(r.error);
      }
    });
  }

  function descartar() {
    setError(null);
    startTransition(async () => {
      const r = await dismissDataChangeAction({ messageId, ref: change.ref });
      if (r.ok) setEstado('descartado');
      else setError(r.error);
    });
  }

  const apagado = estado === 'descartado';

  return (
    <div
      className={`rounded-[18px] border p-4 transition-opacity ${
        apagado
          ? 'border-(--color-border) bg-white opacity-55'
          : destructivo
            ? 'border-amber-200 bg-amber-50/50'
            : 'border-sky-200 bg-sky-50/40'
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={destructivo ? 'warn' : 'info'} size="sm">
          {ENTIDAD[change.entity]}
        </Badge>
        {estado === 'aplicado' && (
          <Badge tone="success" size="sm">
            <Check className="h-3 w-3" /> Aplicado
          </Badge>
        )}
        {apagado && (
          <Badge tone="neutral" size="sm">
            Descartado
          </Badge>
        )}
      </div>

      <p className={`text-[14px] font-semibold text-zinc-900 ${apagado ? 'line-through' : ''}`}>
        {describeDataChange(change)}
      </p>

      <dl className="mt-3 space-y-2">
        {change.diff.map((row) => (
          <div key={row.label} className="text-[13px] leading-relaxed">
            <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-400">
              {row.label}
            </dt>
            <dd className="flex flex-wrap items-baseline gap-2 text-zinc-700">
              {row.before && (
                <>
                  <span className="text-zinc-400 line-through">{row.before}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-zinc-300" />
                </>
              )}
              <span className="font-medium text-zinc-900">{row.after ?? '(se borra)'}</span>
            </dd>
          </div>
        ))}
      </dl>

      {error && <p className="mt-2 text-[13px] text-rose-600">{error}</p>}

      {estado === 'pendiente' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={destructivo ? 'danger' : 'primary'}
            onClick={aplicar}
            disabled={pending}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Aplicar el cambio
          </Button>
          <Button size="sm" variant="ghost" onClick={descartar} disabled={pending}>
            <X className="h-4 w-4" />
            Descartar
          </Button>
        </div>
      ) : estado === 'aplicado' ? (
        <Button asChild size="sm" variant="ghost" className="mt-3">
          <Link href={dataChangeHref(change)}>
            <ExternalLink className="h-4 w-4" />
            Ver en la ficha
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
