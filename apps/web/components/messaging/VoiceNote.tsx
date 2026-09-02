'use client';

import { attachmentUrl, formatDuration, waveformBars } from '@/components/messaging/shared';
import { cn } from '@/lib/cn';
import type { ImAttachment } from '@/lib/messaging/types';
import { Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* ============================================================================
   Nota de voz. Reproductor propio en vez del control nativo del navegador:
   dentro de una burbuja el control nativo ocupa media pantalla, cambia de
   aspecto en cada navegador y no se puede teñir con el color de la marca.

   La onda se dibuja a partir del identificador del adjunto (ver `waveformBars`)
   y se rellena según el punto de reproducción. Cada barra es un botón: pulsar
   una salta a ese momento del audio.
   ========================================================================== */

export function VoiceNote({
  attachment,
  own,
  className,
}: {
  attachment: ImAttachment;
  own?: boolean;
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);

  const bars = useMemo(
    () => waveformBars(attachment.key || attachment.name, 34),
    [attachment.key, attachment.name],
  );

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  }, []);

  const seekTo = useCallback(
    (ratio: number) => {
      const el = audioRef.current;
      if (!el || !Number.isFinite(duration) || duration <= 0) return;
      el.currentTime = duration * ratio;
      setCurrent(el.currentTime);
    },
    [duration],
  );

  // Un solo audio sonando a la vez: al arrancar este, se pausan los demás.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => {
      setPlaying(true);
      for (const other of Array.from(document.querySelectorAll('audio[data-voice-note]'))) {
        if (other !== el) (other as HTMLAudioElement).pause();
      }
    };
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrent(el.currentTime);
    const onMeta = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onEnd = () => {
      setPlaying(false);
      setCurrent(0);
    };
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('ended', onEnd);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('ended', onEnd);
    };
  }, []);

  const remaining = duration > 0 ? duration - current : 0;

  return (
    <div
      className={cn(
        'mt-2 flex items-center gap-3 rounded-[16px] px-3 py-2.5 ring-1 transition-shadow duration-300',
        own
          ? 'bg-white/70 ring-brand-200/70'
          : 'bg-[linear-gradient(120deg,#f4faf7,#eef6f3)] ring-brand-100',
        className,
      )}
    >
      {/* biome-ignore lint/a11y/useMediaCaption: nota de voz del equipo, sin pista de subtítulos */}
      <audio ref={audioRef} data-voice-note src={attachmentUrl(attachment)} preload="metadata" />

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pausar la nota de voz' : 'Reproducir la nota de voz'}
        className={cn(
          'press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-transform duration-300 hover:scale-105',
          'bg-[linear-gradient(135deg,#37766a,#5fa896_60%,#6bc2a4)] shadow-[0_10px_22px_-10px_rgba(55,118,106,0.9)]',
        )}
      >
        {playing ? (
          <Pause className="h-4 w-4" fill="currentColor" />
        ) : (
          <Play className="ml-0.5 h-4 w-4" fill="currentColor" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex h-8 items-center gap-[2px]">
          {bars.map((h, i) => {
            const ratio = (i + 0.5) / bars.length;
            const played = ratio <= progress;
            return (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: la onda es una serie fija por posición
                key={i}
                type="button"
                tabIndex={-1}
                aria-hidden
                onClick={() => seekTo(ratio)}
                className="group/bar flex h-full flex-1 items-center justify-center"
              >
                <span
                  className={cn(
                    'w-full rounded-full transition-all duration-200',
                    played ? 'bg-brand-600' : 'bg-brand-200 group-hover/bar:bg-brand-300',
                    playing && played && 'animate-pulse',
                  )}
                  style={{ height: `${Math.round(h * 100)}%` }}
                />
              </button>
            );
          })}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="truncate text-[12px] font-medium text-zinc-500">
            {attachment.name || 'Nota de voz'}
          </span>
          <span className="shrink-0 text-[12px] font-semibold tabular-nums text-brand-700">
            {duration > 0 ? formatDuration(playing || current > 0 ? remaining : duration) : '—:—'}
          </span>
        </div>
      </div>
    </div>
  );
}
