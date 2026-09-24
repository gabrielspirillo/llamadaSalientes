'use client';

import { clearTrainingChatAction } from '@/app/(dashboard)/dashboard/entrenamiento/actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Callout } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/input';
import { Equalizer } from '@/components/ui/stat';
import type { LessonProposal } from '@/lib/agent-training/model';
import { GraduationCap, Loader2, RotateCcw, Send, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { ProposalCard } from './proposal-card';

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  proposals: LessonProposal[];
}

/** Arranques de conversación. Quitan el folio en blanco, que es lo que frena. */
const SUGERENCIAS = [
  'Cuando preguntan el precio, que no suelte la cifra y ofrezca una primera valoración',
  'Que salude diciendo el nombre de la clínica y pregunte en qué puede ayudar',
  'Si alguien escribe fuera del horario, que avise de cuándo le contestamos',
  'Cuando preguntan por el parking, que diga que hay uno público en la misma calle',
];

/**
 * La conversación de entrenamiento.
 *
 * No es un chat con el asistente: es un chat con el entrenador, que escucha lo
 * que la clínica cuenta y lo convierte en tarjetas. Lo que cambia al asistente
 * es aprobar una tarjeta, nunca el mensaje suelto — por eso el turno del
 * entrenador se lee siempre junto a sus tarjetas.
 */
export function TrainerChat({
  initialTurns,
  agentName,
}: {
  initialTurns: ChatTurn[];
  agentName: string;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>(initialTurns);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limpiando, startLimpiar] = useTransition();
  const router = useRouter();

  const finalRef = useRef<HTMLDivElement | null>(null);

  // Sigue al último turno. Depende de la CANTIDAD: el contenido no cambia una
  // vez escrito y así el efecto no se dispara de más.
  useEffect(() => {
    if (turns.length === 0) return;
    finalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length]);

  async function enviar(texto: string) {
    const limpio = texto.trim();
    if (limpio.length < 2 || sending) return;

    setError(null);
    setDraft('');
    // El mensaje aparece al momento con un id provisional; el definitivo llega
    // con la respuesta. Nunca se usa para aplicar nada, así que no hay riesgo.
    const provisional: ChatTurn = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content: limpio,
      proposals: [],
    };
    setTurns((prev) => [...prev, provisional]);
    setSending(true);

    try {
      const res = await fetch('/api/agent/training/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: limpio }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);

      setTurns((prev) => [
        ...prev.map((t) =>
          t.id === provisional.id ? { ...t, id: body.userMessage?.id ?? t.id } : t,
        ),
        {
          id: body.reply.id,
          role: 'assistant' as const,
          content: body.reply.content,
          proposals: (body.reply.proposals ?? []) as LessonProposal[],
        },
      ]);
    } catch (err) {
      setError((err as Error).message);
      // Se devuelve el texto al cuadro: perder lo escrito por un fallo de red
      // es la forma más rápida de que nadie vuelva a entrenar.
      setDraft(limpio);
      setTurns((prev) => prev.filter((t) => t.id !== provisional.id));
    } finally {
      setSending(false);
    }
  }

  function vaciar() {
    startLimpiar(async () => {
      const r = await clearTrainingChatAction();
      if (r.ok) {
        setTurns([]);
        setError(null);
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <Card className="flex min-h-[560px] flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-(--color-border) px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
            <GraduationCap className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-zinc-900">
              Entrenador de {agentName}
            </p>
            <p className="truncate text-[12px] text-zinc-500">
              Cuéntale qué quieres que cambie. Te lo deja listo para aprobar.
            </p>
          </div>
        </div>
        {turns.length > 0 && (
          <Button variant="ghost" size="sm" onClick={vaciar} disabled={limpiando}>
            {limpiando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">Vaciar la charla</span>
          </Button>
        )}
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
        {turns.length === 0 ? (
          <div className="mx-auto max-w-xl py-6 text-center">
            <span className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
              <GraduationCap className="h-6 w-6" />
            </span>
            <h3 className="text-[18px] font-bold text-zinc-900">
              ¿Qué te gustaría que hiciera mejor?
            </h3>
            <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-zinc-500">
              Escríbelo como se lo contarías a alguien nuevo en recepción. Si tienes un ejemplo de
              una conversación que salió regular, pégalo: con eso basta.
            </p>
            <div className="mt-5 grid gap-2 text-left">
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => enviar(s)}
                  disabled={sending}
                  className="hover-lift rounded-2xl border border-(--color-border) bg-white px-4 py-3 text-[13px] leading-snug text-zinc-700 transition-colors hover:border-brand-200 hover:text-zinc-900 disabled:opacity-60"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((t) =>
            t.role === 'user' ? (
              <div key={t.id} className="flex justify-end gap-3">
                <div className="max-w-[85%] rounded-[18px] rounded-br-md bg-brand-600 px-4 py-2.5 text-[14px] leading-relaxed text-white">
                  {t.content}
                </div>
                <span className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500">
                  <User className="h-4 w-4" />
                </span>
              </div>
            ) : (
              <div key={t.id} className="flex gap-3">
                <span className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
                  <GraduationCap className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="max-w-[92%] whitespace-pre-wrap rounded-[18px] rounded-tl-md bg-zinc-50 px-4 py-2.5 text-[14px] leading-relaxed text-zinc-800">
                    {t.content}
                  </div>
                  {t.proposals.length > 0 && (
                    <div className="space-y-2">
                      {t.proposals.map((p) => (
                        <ProposalCard
                          key={p.ref}
                          messageId={t.id}
                          proposal={p}
                          // La lista de "Lo aprendido" y el contador viven en el
                          // servidor: sin esto, aplicar una enseñanza no movía
                          // el número de la pestaña de al lado.
                          onApplied={() => router.refresh()}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ),
          )
        )}

        {sending && (
          <div className="flex gap-3">
            <span className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
              <GraduationCap className="h-4 w-4" />
            </span>
            <div className="rounded-[18px] rounded-tl-md bg-zinc-50 px-4 py-3">
              <Equalizer />
              <span className="sr-only">Escribiendo</span>
            </div>
          </div>
        )}

        <div ref={finalRef} />
      </div>

      <div className="border-t border-(--color-border) px-4 py-4 sm:px-6">
        {error && (
          <Callout tone="danger" className="mb-3">
            {error}
          </Callout>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter envía; Mayús+Enter hace salto de línea. Quien cuenta un
              // caso largo necesita párrafos.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void enviar(draft);
              }
            }}
            placeholder="Ej: cuando preguntan por ortodoncia invisible, que diga que la primera valoración es gratis y ofrezca hueco esta semana."
            className="min-h-[52px] flex-1 resize-none"
            aria-label="Mensaje para el entrenador"
            disabled={sending}
          />
          <Button
            onClick={() => void enviar(draft)}
            disabled={sending || draft.trim().length < 2}
            aria-label="Enviar"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mt-2 text-[12px] text-zinc-400">
          Nada cambia hasta que apruebas una tarjeta.
        </p>
      </div>
    </Card>
  );
}
