'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import {
  SESSION_BEHAVIOR_FACES,
  SESSION_BEHAVIOR_LABELS,
  type SessionBehavior,
} from '@/lib/care-profile/policy';
import { cn } from '@/lib/cn';
import { History, Lock, NotebookPen } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

export interface HistoryNoteView {
  id: string;
  whenLabel: string;
  professionalId: string;
  professionalName: string;
  behavior: SessionBehavior | null;
  isPrivate: boolean;
  summary: string;
  symptoms: string | null;
  examination: string | null;
  treatmentPerformed: string | null;
  observations: string | null;
  nextSteps: string | null;
}

/**
 * La historia clínica como línea de tiempo, la más reciente arriba, con un
 * filtro por profesional cuando atienden varios. Sin notas, dice cómo
 * escribir la primera (o por qué este rol no puede).
 */
export function HistoryTimeline({
  notes,
  pediatric,
  writeHref,
}: {
  notes: HistoryNoteView[];
  pediatric: boolean;
  /** Dónde se escribe la nota; null si el rol no puede. */
  writeHref: string | null;
}) {
  const [professionalId, setProfessionalId] = React.useState<string>('all');
  const professionals = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const n of notes) if (!seen.has(n.professionalId)) seen.set(n.professionalId, n.professionalName);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [notes]);
  const shown = professionalId === 'all' ? notes : notes.filter((n) => n.professionalId === professionalId);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-[18px] font-bold tracking-tight text-zinc-900">
          Historia clínica{' '}
          <span className="text-[13px] font-medium text-zinc-600">· la más reciente arriba</span>
        </h2>
        {professionals.length > 1 && (
          <fieldset className="m-0 flex flex-wrap gap-1.5 border-0 p-0">
            <legend className="sr-only">Filtrar por profesional</legend>
            <Chip active={professionalId === 'all'} onClick={() => setProfessionalId('all')}>
              Todos
            </Chip>
            {professionals.map((p) => (
              <Chip key={p.id} active={professionalId === p.id} onClick={() => setProfessionalId(p.id)}>
                {p.name}
              </Chip>
            ))}
          </fieldset>
        )}
      </div>

      {notes.length === 0 ? (
        <EmptyState
          icon={<History className="h-5 w-5" />}
          title="Todavía no hay notas"
          description={
            writeHref
              ? 'Después de atender, la nota de hoy se escribe en la pestaña Visita de hoy: diagnóstico, exploración y lo que toca la próxima vez.'
              : 'Las notas las escribe el profesional que atiende. Tu rol permite consultarlas.'
          }
          action={
            writeHref ? (
              <Button asChild>
                <Link href={writeHref} prefetch={false}>
                  <NotebookPen className="h-4 w-4" /> Escribir la primera nota
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-zinc-600">
          Este profesional no tiene notas de este paciente.
        </p>
      ) : (
        <ol className="flex flex-col">
          {shown.map((n, idx) => {
            const last = idx === shown.length - 1;
            return (
              <li key={n.id} className="grid grid-cols-[18px_minmax(0,1fr)] gap-3">
                <div className="flex flex-col items-center">
                  <span
                    aria-hidden
                    className="mt-1 h-3 w-3 rounded-full bg-brand-500 ring-4 ring-brand-100"
                  />
                  {!last && <span aria-hidden className="mt-1.5 w-0.5 flex-1 bg-(--color-border)" />}
                </div>
                <div className="flex min-w-0 flex-col gap-1.5 pb-6">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span className="text-[13px] font-bold text-zinc-900">{n.whenLabel}</span>
                    <span className="text-[12px] text-zinc-600">{n.professionalName}</span>
                    {n.behavior && (
                      <Badge tone="neutral" title="Cómo se portó en la sesión">
                        <span aria-hidden>{SESSION_BEHAVIOR_FACES[n.behavior]}</span>{' '}
                        {SESSION_BEHAVIOR_LABELS[n.behavior]}
                      </Badge>
                    )}
                    {n.isPrivate && (
                      <Badge tone="neutral">
                        <Lock className="mr-1 h-3 w-3" /> Privada
                      </Badge>
                    )}
                  </div>
                  <p className="text-[15px] font-semibold text-zinc-900">
                    <span className="text-zinc-600">{pediatric ? 'Diagnóstico: ' : 'Motivo: '}</span>
                    {n.summary}
                  </p>
                  {n.symptoms && (
                    <p className="whitespace-pre-line text-[13px] leading-relaxed text-zinc-700">
                      <strong>Síntomas:</strong> {n.symptoms}
                    </p>
                  )}
                  {n.examination && (
                    <p className="whitespace-pre-line text-[13px] leading-relaxed text-zinc-700">
                      <strong>Exploración:</strong> {n.examination}
                    </p>
                  )}
                  {n.treatmentPerformed && (
                    <p className="text-[13px] leading-relaxed text-zinc-700">
                      <strong>{pediatric ? 'Tratamiento' : 'Se hizo'}:</strong> {n.treatmentPerformed}
                    </p>
                  )}
                  {n.observations && (
                    <p className="whitespace-pre-line text-[13px] leading-relaxed text-zinc-700">
                      {n.observations}
                    </p>
                  )}
                  {n.nextSteps && (
                    <p className="mt-1 rounded-[10px] bg-brand-50 p-2.5 text-[13px] text-brand-800">
                      <strong>Próximo paso:</strong> {n.nextSteps}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1 text-[12px] font-semibold ring-1 transition-colors',
        active
          ? 'bg-brand-600 text-white ring-brand-600'
          : 'bg-white text-zinc-700 ring-(--color-border) hover:bg-brand-50',
      )}
    >
      {children}
    </button>
  );
}
