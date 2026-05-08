'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Mic, MicOff, Phone, PhoneOff, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type Turn = {
  id: number;
  speaker: 'agent' | 'user';
  text: string;
  ts: number;
};

type CallState = 'idle' | 'connecting' | 'live' | 'ended' | 'error';

export function AgentTester() {
  const [state, setState] = useState<CallState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const clientRef = useRef<unknown>(null);
  const startedAtRef = useRef<number | null>(null);

  // Cronómetro
  useEffect(() => {
    if (state !== 'live') return;
    const iv = setInterval(() => {
      if (startedAtRef.current) {
        setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [state]);

  async function startCall() {
    setError(null);
    setTranscript([]);
    setDuration(0);
    setState('connecting');

    try {
      const res = await fetch('/api/retell/web-call', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Error ${res.status}`);
      }
      const { accessToken } = (await res.json()) as { accessToken: string };

      // Import dinámico para que el SDK no infle el bundle del SSR
      const { RetellWebClient } = await import('retell-client-js-sdk');
      const client = new RetellWebClient();
      clientRef.current = client;

      client.on('call_started', () => {
        startedAtRef.current = Date.now();
        setState('live');
      });

      // call_ready: el room está conectado pero audio playback puede estar bloqueado.
      // Forzamos startAudioPlayback() para evitar autoplay-blocked en Chrome/Safari.
      client.on('call_ready', () => {
        const c = clientRef.current as { startAudioPlayback?: () => Promise<void> } | null;
        c?.startAudioPlayback?.().catch((err) => {
          console.error('startAudioPlayback failed:', err);
        });
      });

      client.on('call_ended', () => {
        setState('ended');
      });

      client.on('error', (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setState('error');
        try {
          (clientRef.current as { stopCall?: () => void } | null)?.stopCall?.();
        } catch {}
      });

      // Eventos de transcripción incrementales del SDK
      client.on('update', (update: { transcript?: Array<{ role: string; content: string }> }) => {
        if (!update.transcript) return;
        const turns: Turn[] = update.transcript.map((t, idx) => ({
          id: idx,
          speaker: t.role === 'agent' ? 'agent' : 'user',
          text: t.content,
          ts: Date.now(),
        }));
        setTranscript(turns);
      });

      await client.startCall({ accessToken, sampleRate: 24000 });
      // Doble seguro: si el SDK no emite call_ready, lo intentamos directo.
      // Esta llamada es safe — si ya está reproduciendo, es no-op.
      try {
        await (client as unknown as { startAudioPlayback?: () => Promise<void> }).startAudioPlayback?.();
      } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al iniciar la llamada');
      setState('error');
    }
  }

  function stopCall() {
    try {
      (clientRef.current as { stopCall?: () => void } | null)?.stopCall?.();
    } catch {}
    setState('ended');
  }

  function toggleMute() {
    const c = clientRef.current as { mute?: () => void; unmute?: () => void } | null;
    if (!c) return;
    if (muted) c.unmute?.();
    else c.mute?.();
    setMuted(!muted);
  }

  const formatDuration = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Control panel */}
      <Card className="lg:col-span-1">
        <div className="p-6 flex flex-col items-center text-center">
          <div
            className={`relative h-20 w-20 rounded-full flex items-center justify-center transition-all ${
              state === 'live'
                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
                : state === 'connecting'
                  ? 'bg-amber-500 text-white animate-pulse'
                  : 'bg-zinc-900 text-white'
            }`}
          >
            {state === 'live' && (
              <span className="absolute inset-0 rounded-full bg-emerald-400/40 animate-ping" />
            )}
            <Phone className="h-8 w-8 relative z-10" />
          </div>

          <h3 className="text-lg font-semibold tracking-tight mt-4">
            {state === 'idle' && 'Probar agente'}
            {state === 'connecting' && 'Conectando…'}
            {state === 'live' && 'En llamada'}
            {state === 'ended' && 'Llamada finalizada'}
            {state === 'error' && 'Error'}
          </h3>

          {state === 'live' && (
            <p className="text-sm text-zinc-500 mt-1 tabular-nums">{formatDuration(duration)}</p>
          )}
          {state === 'idle' && (
            <p className="text-sm text-zinc-500 mt-2 max-w-xs">
              Hablá con el agente directamente desde tu navegador. No consume minutos del plan.
            </p>
          )}

          {error && (
            <div className="mt-4 w-full rounded-lg bg-red-50 border border-red-200 text-red-800 px-3 py-2 text-xs text-left">
              {error}
            </div>
          )}

          <div className="mt-6 flex flex-col gap-2 w-full">
            {state === 'idle' || state === 'ended' || state === 'error' ? (
              <Button size="lg" className="w-full" onClick={startCall}>
                <Phone className="h-4 w-4" />
                {state === 'ended' ? 'Volver a llamar' : 'Iniciar llamada'}
              </Button>
            ) : (
              <>
                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full"
                  onClick={toggleMute}
                  disabled={state !== 'live'}
                >
                  {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  {muted ? 'Activar micrófono' : 'Silenciar micrófono'}
                </Button>
                <Button size="lg" variant="primary" className="w-full bg-red-600 hover:bg-red-700" onClick={stopCall}>
                  <PhoneOff className="h-4 w-4" />
                  Colgar
                </Button>
              </>
            )}
          </div>

          <p className="text-xs text-zinc-400 mt-5">
            Tu navegador pedirá permiso para usar el micrófono.
          </p>
        </div>
      </Card>

      {/* Live transcript */}
      <Card className="lg:col-span-2">
        <div className="flex items-center justify-between p-6 pb-4">
          <h3 className="text-base font-semibold tracking-tight">Transcripción en vivo</h3>
          {state === 'live' && (
            <Badge tone="success">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse mr-1" />
              en vivo
            </Badge>
          )}
        </div>
        <div className="border-t border-zinc-100 px-6 py-5 space-y-4 min-h-[400px] max-h-[500px] overflow-y-auto">
          {transcript.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[360px] text-center text-sm text-zinc-400">
              <Phone className="h-8 w-8 mb-3 text-zinc-300" />
              {state === 'idle'
                ? 'La transcripción aparecerá acá cuando inicies la llamada.'
                : state === 'connecting'
                  ? 'Conectando con el agente…'
                  : 'Esperando audio…'}
            </div>
          ) : (
            transcript.map((turn) => (
              <div key={turn.id} className="flex gap-3">
                <div
                  className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
                    turn.speaker === 'agent'
                      ? 'bg-zinc-900 text-white'
                      : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  {turn.speaker === 'agent' ? (
                    <Phone className="h-3.5 w-3.5" />
                  ) : (
                    <User className="h-3.5 w-3.5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-zinc-500 mb-1">
                    {turn.speaker === 'agent' ? 'Agente' : 'Tú'}
                  </p>
                  <p
                    className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      turn.speaker === 'agent'
                        ? 'bg-zinc-100 text-zinc-800'
                        : 'bg-blue-50 text-blue-900'
                    }`}
                  >
                    {turn.text}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
