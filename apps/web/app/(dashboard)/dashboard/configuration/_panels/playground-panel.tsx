'use client';

import { useRef, useState, useTransition } from 'react';

import { type PlaygroundResult, runAgentPlayground } from './playground-actions';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  trace?: PlaygroundResult;
}

export function PlaygroundPanel() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);

  function send() {
    const text = input.trim();
    if (!text || pending) return;
    setError(null);
    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    startTransition(async () => {
      const res = await runAgentPlayground({ userText: text, history, phone: phone || undefined });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setTurns((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: res.data.responseText ?? '(sin respuesta)',
          trace: res.data,
        },
      ]);
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: 1e9 }));
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">Probador del agente de WhatsApp</h2>
        <p className="text-sm text-zinc-500">
          Chateá con el agente usando la configuración real de tu clínica (persona, tratamientos,
          FAQs con búsqueda semántica, guardrails). Las acciones que agendan/cancelan/registran se{' '}
          <strong>simulan</strong>: no se crea nada real, no se envía WhatsApp ni se guarda nada.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-xs font-medium text-zinc-700">
            Teléfono de prueba (opcional — carga la memoria de ese lead)
          </span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+34699111222"
            className="mt-1 w-56 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setTurns([]);
            setError(null);
          }}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          Reiniciar conversación
        </button>
      </div>

      <div
        ref={listRef}
        className="h-[420px] overflow-y-auto rounded-xl border border-zinc-200 bg-zinc-50/50 p-4"
      >
        {turns.length === 0 ? (
          <p className="text-sm text-zinc-400">
            Escribí un mensaje como lo haría un paciente para ver cómo responde el agente.
          </p>
        ) : (
          <ul className="space-y-3">
            {turns.map((t, i) => (
              <li key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className="max-w-[80%]">
                  <div
                    className={`whitespace-pre-line rounded-2xl px-3 py-2 text-sm ${
                      t.role === 'user'
                        ? 'bg-emerald-600 text-white'
                        : 'border border-zinc-200 bg-white text-zinc-800'
                    }`}
                  >
                    {t.content}
                  </div>
                  {t.trace && <TraceDetails trace={t.trace} />}
                </div>
              </li>
            ))}
            {pending && <li className="text-xs text-zinc-400">El agente está pensando…</li>}
          </ul>
        )}
      </div>

      {error && <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="Mensaje del paciente… (Ctrl/Cmd+Enter para enviar)"
          className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || !input.trim()}
          className="self-end rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {pending ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
    </div>
  );
}

function TraceDetails({ trace }: { trace: PlaygroundResult }) {
  const [open, setOpen] = useState(false);
  const badges: string[] = [];
  if (trace.intent) badges.push(`intent: ${trace.intent}`);
  if (trace.handoff) badges.push('handoff');
  if (trace.urgent) badges.push('urgent');
  return (
    <div className="mt-1 text-[11px] text-zinc-500">
      <button type="button" onClick={() => setOpen((v) => !v)} className="underline">
        {open ? 'ocultar' : 'ver'} detalles
      </button>
      <span className="ml-2">{badges.join(' · ')}</span>
      {open && (
        <div className="mt-1 space-y-1 rounded-lg border border-zinc-200 bg-white p-2">
          <div>
            modelo: {trace.model} · tokens: {trace.tokensIn}/{trace.tokensOut} · {trace.latencyMs}ms
          </div>
          {trace.intentReasoning && <div>guardrail/nota: {trace.intentReasoning}</div>}
          {trace.errorText && <div className="text-red-600">error: {trace.errorText}</div>}
          {trace.toolsCalled.length > 0 && (
            <div>
              <div className="font-medium">tools:</div>
              <ul className="space-y-0.5">
                {trace.toolsCalled.map((tc, i) => (
                  <li key={i}>
                    {tc.ok ? '✓' : '✗'} <code>{tc.name}</code>({JSON.stringify(tc.args)}) →{' '}
                    {tc.result.slice(0, 120)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
