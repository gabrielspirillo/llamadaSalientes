'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Callout } from '@/components/ui/feedback';
import { Input, Label } from '@/components/ui/input';
import { AlertTriangle, Bot, MessageSquare, RotateCcw, Send, User, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  result: string;
  latencyMs: number;
  error: string | null;
}

interface Turn {
  id: string;
  speaker: 'agent' | 'user';
  text: string;
  /** Sólo en los turnos del agente: por qué contestó lo que contestó. */
  meta?: {
    intent: string | null;
    confidence: number | null;
    handoff: boolean;
    urgent: boolean;
    model: string;
    latencyMs: number;
    tools: ToolTrace[];
  };
}

const INTENT_TONE: Record<string, 'success' | 'info' | 'warn' | 'danger' | 'neutral'> = {
  SCHEDULING: 'success',
  FAQ: 'info',
  URGENT: 'danger',
  HANDOFF: 'warn',
  OTHER: 'neutral',
};

function nuevaSesion(): string {
  return crypto.randomUUID();
}

/**
 * Simulador del agente de WhatsApp.
 *
 * No imita al agente: llama al mismo orquestador que atiende a los pacientes,
 * con el mismo prompt, el mismo modelo y las mismas tools. Por eso enseña la
 * traza —qué consultó antes de responder—, que es donde se ve si el agente se
 * está inventando la respuesta o la fue a buscar.
 */
export function WhatsappTester() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [phone, setPhone] = useState('');
  const [sessionId, setSessionId] = useState<string>('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  const finalRef = useRef<HTMLDivElement | null>(null);

  // El id de sesión se genera en el cliente al montar: `crypto.randomUUID()` no
  // existe en el render del servidor y además haría que dos pestañas
  // compartieran la misma conversación simulada.
  useEffect(() => {
    setSessionId(nuevaSesion());
  }, []);

  // Sigue al último mensaje. Depende de la CANTIDAD de turnos, no del array:
  // el contenido no cambia una vez escrito y así el efecto no se dispara de más.
  useEffect(() => {
    if (turns.length === 0) return;
    finalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length]);

  function reiniciar() {
    setTurns([]);
    setError(null);
    setAbierta(null);
    setSessionId(nuevaSesion());
  }

  async function enviar() {
    const texto = draft.trim();
    if (!texto || sending) return;

    setError(null);
    setDraft('');
    const mio: Turn = { id: `u-${Date.now()}`, speaker: 'user', text: texto };
    setTurns((prev) => [...prev, mio]);
    setSending(true);

    try {
      // El historial que ve el agente es el de ANTES de este mensaje: el
      // mensaje actual va en `text`. Mandarlo en los dos sitios le hacía creer
      // que el paciente lo había escrito dos veces.
      const history = turns.map((t) => ({
        role: t.speaker === 'agent' ? ('assistant' as const) : ('user' as const),
        content: t.text,
      }));

      const res = await fetch('/api/agent/whatsapp-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: texto,
          history,
          sessionId: sessionId || undefined,
          phone: phone.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);

      const botones: string[] = (body.responseButtons?.buttons ?? []).map(
        (b: { title: string }) => b.title,
      );
      const texto_respuesta: string =
        body.responseText ??
        body.responseButtons?.bodyText ??
        (body.handoff ? '(sin respuesta: derivó a una persona del equipo)' : '(sin respuesta)');

      setTurns((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          speaker: 'agent',
          text: botones.length
            ? `${texto_respuesta}\n\n· ${botones.join('\n· ')}`
            : texto_respuesta,
          meta: {
            intent: body.intent ?? null,
            confidence: body.intentConfidence ?? null,
            handoff: Boolean(body.handoff),
            urgent: Boolean(body.urgent),
            model: body.model ?? '',
            latencyMs: body.latencyMs ?? 0,
            tools: body.toolsCalled ?? [],
          },
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo contactar con el agente');
      // Se devuelve el texto al cuadro para que no haya que reescribirlo.
      setDraft(texto);
      setTurns((prev) => prev.filter((t) => t.id !== mio.id));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
      <Card className="lg:col-span-1">
        <div className="p-4 sm:p-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#059669,#34d399)] text-white shadow-[0_18px_40px_-14px_rgba(16,185,129,0.9)]">
            <MessageSquare className="h-7 w-7" />
          </div>
          <h3 className="mt-4 text-[19px] font-extrabold tracking-tight text-zinc-900">
            Escríbele como un paciente
          </h3>
          <p className="mt-2 text-sm text-zinc-500">
            Es el mismo agente que atiende WhatsApp: mismo prompt, mismo modelo y las mismas
            herramientas.
          </p>

          <div className="mt-5">
            <Label htmlFor="wa-tel">Teléfono del paciente</Label>
            <Input
              id="wa-tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+34600000000"
              inputMode="tel"
              autoComplete="off"
            />
            <p className="mt-1.5 text-xs text-zinc-500">
              Con el que el agente busca la ficha del paciente. Vacío usa uno de prueba.
            </p>
          </div>

          <Callout tone="warn" icon={<AlertTriangle className="h-4 w-4" />} className="mt-5">
            Las herramientas son reales: si el agente reserva una cita, la cita queda en la agenda.
          </Callout>

          <Button variant="secondary" className="mt-4 w-full" onClick={reiniciar}>
            <RotateCcw className="h-4 w-4" />
            Empezar de cero
          </Button>
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <div className="flex items-center justify-between p-4 sm:p-6 pb-3 sm:pb-4">
          <h3 className="text-[16px] font-semibold tracking-tight text-zinc-900">Conversación</h3>
          {sending && (
            <Badge tone="success">
              <span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              escribiendo…
            </Badge>
          )}
        </div>

        <div className="min-h-[300px] max-h-[52vh] space-y-4 overflow-y-auto border-t border-[--color-border-subtle] px-4 py-4 sm:min-h-[360px] sm:px-6 sm:py-5">
          {turns.length === 0 ? (
            <div className="flex h-[300px] flex-col items-center justify-center text-center text-sm text-zinc-400">
              <span className="mb-3 inline-flex h-12 w-12 animate-float items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#effaf5,#ddf3ea)] text-brand-500">
                <MessageSquare className="h-5 w-5" />
              </span>
              Prueba con &quot;¿qué días atiende la doctora?&quot; o &quot;quiero una
              limpieza&quot;.
            </div>
          ) : (
            turns.map((turn) => (
              <div key={turn.id} className="flex gap-3">
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    turn.speaker === 'agent'
                      ? 'bg-[linear-gradient(135deg,#059669,#34d399)] text-white'
                      : 'bg-sky-100 text-sky-700'
                  }`}
                >
                  {turn.speaker === 'agent' ? (
                    <Bot className="h-3.5 w-3.5" />
                  ) : (
                    <User className="h-3.5 w-3.5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="mb-1 text-xs font-medium text-zinc-500">
                    {turn.speaker === 'agent' ? 'Asistente' : 'Tú'}
                  </p>
                  <p
                    className={`whitespace-pre-wrap rounded-2xl rounded-tl-md px-4 py-2.5 text-[14px] leading-relaxed ${
                      turn.speaker === 'agent'
                        ? 'bg-[#f4f7f6] text-brand-900'
                        : 'bg-[#e9f4fe] text-sky-900'
                    }`}
                  >
                    {turn.text}
                  </p>

                  {turn.meta && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {turn.meta.intent && (
                        <Badge tone={INTENT_TONE[turn.meta.intent] ?? 'neutral'} size="sm">
                          {turn.meta.intent}
                          {turn.meta.confidence !== null
                            ? ` · ${Math.round(turn.meta.confidence * 100)}%`
                            : ''}
                        </Badge>
                      )}
                      {turn.meta.urgent && (
                        <Badge tone="danger" size="sm">
                          urgente
                        </Badge>
                      )}
                      {turn.meta.handoff && (
                        <Badge tone="warn" size="sm">
                          deriva a una persona
                        </Badge>
                      )}
                      {turn.meta.tools.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setAbierta(abierta === turn.id ? null : turn.id)}
                          className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 transition-colors hover:bg-zinc-200"
                        >
                          <Wrench className="h-3 w-3" />
                          {turn.meta.tools.length}{' '}
                          {turn.meta.tools.length === 1 ? 'consulta' : 'consultas'}
                        </button>
                      )}
                      <span className="text-[11px] text-zinc-400">
                        {turn.meta.model} · {(turn.meta.latencyMs / 1000).toFixed(1)}s
                      </span>
                    </div>
                  )}

                  {turn.meta && abierta === turn.id && (
                    <div className="mt-2 space-y-2 rounded-2xl border border-[--color-border-subtle] bg-white/70 p-3">
                      {turn.meta.tools.map((t, i) => (
                        <div key={`${turn.id}-${t.name}-${i}`} className="text-[12px]">
                          <div className="flex items-center gap-1.5">
                            <Badge tone={t.ok ? 'success' : 'danger'} size="sm">
                              {t.name}
                            </Badge>
                            <span className="text-zinc-400">{t.latencyMs} ms</span>
                          </div>
                          <pre className="mt-1 overflow-x-auto rounded-xl bg-zinc-50 p-2 text-[11px] leading-relaxed text-zinc-600">
                            {JSON.stringify(t.args, null, 2)}
                          </pre>
                          <p className="mt-1 whitespace-pre-wrap text-[11px] text-zinc-500">
                            {t.error ?? t.result}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={finalRef} />
        </div>

        <div className="border-t border-[--color-border-subtle] p-4 sm:px-6">
          {error && (
            <div className="mb-3 animate-fade-up rounded-2xl border border-rose-100 bg-rose-50/80 px-3.5 py-2.5 text-[13px] text-rose-700">
              {error}
            </div>
          )}
          <div className="flex items-end gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void enviar();
                }
              }}
              placeholder="Escribe como si fueras el paciente…"
              disabled={sending}
              autoComplete="off"
            />
            <Button onClick={() => void enviar()} disabled={sending || draft.trim() === ''}>
              <Send className="h-4 w-4" />
              Enviar
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
