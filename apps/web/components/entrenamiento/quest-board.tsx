'use client';

import { applyQuestAction } from '@/app/(dashboard)/dashboard/entrenamiento/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/stat';
import { LESSON_KIND_LABEL } from '@/lib/agent-training/model';
import type { AgentLevel, Quest } from '@/lib/agent-training/quests';
import { Check, ChevronDown, Loader2, Sparkles, Trophy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * Los ajustes recomendados, como una partida.
 *
 * Nadie sabe de entrada qué hay que enseñarle a un asistente, y la pantalla en
 * blanco es lo que hace que una clínica entre una vez y no vuelva. Aquí tiene
 * el siguiente paso siempre escrito, con el texto ya redactado: leerlo y
 * pulsar. Y un nivel que sube, que es lo que hace que se pulse el tercero.
 */
export function QuestBoard({
  level,
  pending,
  activeLessons,
}: {
  level: AgentLevel;
  pending: Quest[];
  activeLessons: number;
}) {
  const [abierto, setAbierto] = useState(false);
  const [aplicando, setAplicando] = useState<string | null>(null);
  const [hechos, setHechos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  function aplicar(quest: Quest) {
    setError(null);
    setAplicando(quest.id);
    startTransition(async () => {
      const r = await applyQuestAction(quest.id);
      setAplicando(null);
      if (r.ok) {
        // Se queda en pantalla marcado un momento: si desapareciera sin más,
        // pulsar no daría ninguna señal de haber servido para algo.
        setHechos((prev) => [...prev, quest.id]);
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  const visibles = abierto ? pending : pending.slice(0, 3);
  const restantes = pending.length - visibles.length;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden p-5">
        <div className="mb-3 flex items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#37766a,#6bc2a4)] text-white shadow-[0_8px_20px_-10px_rgba(55,118,106,0.8)]">
            <Trophy className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-400">
              Nivel {level.level}
            </p>
            <p className="truncate text-[17px] font-extrabold tracking-tight text-zinc-900">
              {level.label}
            </p>
          </div>
        </div>

        <p className="mb-3 text-[13px] leading-relaxed text-zinc-500">{level.blurb}</p>

        <ProgressBar value={level.progress * 100} tone="mint" />
        <p className="mt-2 text-[12px] text-zinc-500">
          {activeLessons === 1 ? '1 enseñanza activa' : `${activeLessons} enseñanzas activas`}
          {level.nextAt !== null && (
            <>
              {' · '}
              {level.nextAt - activeLessons === 1
                ? 'una más para subir de nivel'
                : `${level.nextAt - activeLessons} más para subir de nivel`}
            </>
          )}
        </p>
      </Card>

      <Card className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-600" />
          <h3 className="text-[15px] font-semibold tracking-tight text-zinc-900">
            Ajustes recomendados
          </h3>
        </div>
        <p className="mb-4 text-[13px] leading-relaxed text-zinc-500">
          Ya están redactados. Pulsa y tu asistente lo aplica en la siguiente conversación.
        </p>

        {error && <p className="mb-3 text-[13px] text-rose-600">{error}</p>}

        {pending.length === 0 ? (
          <div className="rounded-[18px] bg-emerald-50/70 p-4 text-[13px] leading-relaxed text-emerald-900">
            Le habéis enseñado todos los ajustes recomendados. A partir de aquí, lo que le falte se
            lo cuentas tú en la charla de la izquierda.
          </div>
        ) : (
          <div className="space-y-2.5">
            {visibles.map((q) => {
              const hecho = hechos.includes(q.id);
              return (
                <div
                  key={q.id}
                  className={`rounded-[18px] border p-4 transition-colors ${
                    hecho
                      ? 'border-emerald-200 bg-emerald-50/60'
                      : 'border-(--color-border) bg-white'
                  }`}
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <Badge tone="neutral" size="sm">
                      {LESSON_KIND_LABEL[q.kind]}
                    </Badge>
                    {hecho && (
                      <Badge tone="success" size="sm">
                        <Check className="h-3 w-3" /> Aprendido
                      </Badge>
                    )}
                  </div>
                  <p className="text-[14px] font-semibold text-zinc-900">{q.title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-zinc-500">{q.why}</p>
                  <p className="mt-2 rounded-xl bg-zinc-50 px-3 py-2 text-[13px] leading-relaxed text-zinc-600">
                    {q.instruction}
                  </p>
                  {!hecho && (
                    <Button
                      size="sm"
                      className="mt-3"
                      onClick={() => aplicar(q)}
                      disabled={aplicando !== null}
                    >
                      {aplicando === q.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                      Enseñárselo
                    </Button>
                  )}
                </div>
              );
            })}

            {restantes > 0 && (
              <Button variant="ghost" size="sm" className="w-full" onClick={() => setAbierto(true)}>
                <ChevronDown className="h-4 w-4" />
                Ver {restantes} ajuste{restantes === 1 ? '' : 's'} más
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
