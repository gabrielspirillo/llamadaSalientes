'use client';

import { Button } from '@/components/ui/button';
import { AlertCircle, Loader2, Pause, Play, RotateCcw, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type Props = {
  callId: string;
};

type LoadState = 'idle' | 'loading' | 'ready' | 'error' | 'too-early';

export function AudioPlayer({ callId }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoaded = () => {
      setLoadState('ready');
      setDuration(audio.duration || 0);
    };
    const onTime = () => setCurrentTime(audio.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    const onError = () => {
      setLoadState('error');
      setErrorMsg('No se pudo cargar el audio');
    };

    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, []);

  async function load() {
    setLoadState('loading');
    setErrorMsg(null);
    try {
      // Pre-flight: HEAD para detectar 425 / 404 sin descargar el blob entero.
      // Pasamos esto directamente al <audio> que sabe streamear con Range requests.
      const head = await fetch(`/api/calls/${callId}/recording`, {
        method: 'HEAD',
      });
      if (head.status === 425) {
        setLoadState('too-early');
        setErrorMsg('La grabación todavía no está lista (Retell la procesa después de la llamada)');
        return;
      }
      if (head.status === 404) {
        setLoadState('error');
        setErrorMsg('No se encontró la grabación');
        return;
      }
      if (!head.ok && head.status !== 405 /* HEAD no soportado, intentamos GET */) {
        setLoadState('error');
        setErrorMsg(`Error ${head.status} al cargar`);
        return;
      }

      // Asignamos directo la URL al <audio> para streaming progresivo.
      if (audioRef.current) {
        audioRef.current.src = `/api/calls/${callId}/recording`;
        audioRef.current.load();
      }
    } catch (e) {
      setLoadState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Error al cargar');
    }
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else void audio.play();
  }

  function seek(delta: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(duration, audio.currentTime + delta));
  }

  function onSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Number(e.target.value);
  }

  function fmt(s: number) {
    if (!Number.isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  if (loadState === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center py-6">
        <Volume2 className="h-8 w-8 text-zinc-300 mb-3" />
        <p className="text-sm text-zinc-500 mb-4">Cargá la grabación para escucharla.</p>
        <Button size="sm" onClick={load}>
          <Play className="h-4 w-4" /> Cargar grabación
        </Button>
      </div>
    );
  }

  if (loadState === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <Loader2 className="h-6 w-6 text-zinc-400 animate-spin mb-3" />
        <p className="text-sm text-zinc-500">Descargando grabación…</p>
      </div>
    );
  }

  if (loadState === 'too-early') {
    return (
      <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 p-4">
        <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-900">Grabación procesándose</p>
          <p className="text-xs text-amber-700 mt-0.5">
            Retell genera el audio entre 30 y 90 segundos después de que termina la llamada. Si
            recién colgaste, esperá un momento y dale al botón.
          </p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={load}>
            <RotateCcw className="h-3.5 w-3.5" /> Reintentar
          </Button>
        </div>
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="flex items-start gap-3 rounded-lg bg-red-50 border border-red-200 p-4">
        <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-red-900">No se pudo cargar el audio</p>
          <p className="text-xs text-red-700 mt-0.5">{errorMsg}</p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={load}>
            <RotateCcw className="h-3.5 w-3.5" /> Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} preload="metadata" className="hidden" />

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={togglePlay}
          className="h-12 w-12 inline-flex items-center justify-center rounded-full bg-black text-white hover:bg-zinc-800 transition-colors active:scale-95 shrink-0"
        >
          {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2 text-xs tabular-nums text-zinc-500">
            <span>{fmt(currentTime)}</span>
            <span>{fmt(duration)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={onSeek}
            className="w-full h-1.5 rounded-full bg-zinc-200 accent-zinc-900 cursor-pointer"
          />
          <div className="flex items-center gap-2 mt-3">
            <Button variant="ghost" size="sm" onClick={() => seek(-10)}>
              −10s
            </Button>
            <Button variant="ghost" size="sm" onClick={() => seek(10)}>
              +10s
            </Button>
            <span className="text-xs text-zinc-400 ml-auto">
              {playing ? 'Reproduciendo' : 'Pausado'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
