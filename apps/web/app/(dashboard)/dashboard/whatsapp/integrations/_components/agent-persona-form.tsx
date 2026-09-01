'use client';

import { useState, useTransition } from 'react';

import { saveWhatsappAgentSettings } from '../actions';

interface Props {
  initial: { persona: string | null; agentName: string | null } | null;
}

export function AgentPersonaForm({ initial }: Props) {
  const [persona, setPersona] = useState(initial?.persona ?? '');
  const [agentName, setAgentName] = useState(initial?.agentName ?? '');
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      const res = await saveWhatsappAgentSettings({ persona, agentName });
      setFeedback(
        res.success
          ? { ok: true, msg: 'Personalización guardada.' }
          : { ok: false, msg: res.error },
      );
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span className="block text-xs font-medium text-zinc-700">
          Nombre del agente (opcional)
        </span>
        <input
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          maxLength={60}
          placeholder="Por ejemplo: Lucía"
          className="mt-1 w-full rounded-lg border border-[--color-border] px-3 py-1.5 text-sm"
        />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-zinc-700">
          Persona / instrucciones extra (opcional)
        </span>
        <textarea
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          maxLength={2000}
          rows={5}
          placeholder="Por ejemplo: tono cálido y cercano. Menciona la promoción de blanqueamiento cuando encaje. Trata de usted a las personas mayores."
          className="mt-1 w-full rounded-lg border border-[--color-border] px-3 py-1.5 text-sm"
        />
        <span className="mt-1 block text-[11px] text-zinc-400">
          Afina el tono y el foco del agente. No anula las reglas de seguridad, los datos oficiales
          ni los protocolos de urgencia y de paso a una persona. ({persona.length}/2000)
        </span>
      </label>
      {feedback && (
        <div
          className={`rounded px-3 py-2 text-xs ${
            feedback.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
          }`}
        >
          {feedback.msg}
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-[linear-gradient(120deg,#37766a,#5fa896)] px-5 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {pending ? 'Guardando…' : 'Guardar personalización'}
      </button>
    </form>
  );
}
