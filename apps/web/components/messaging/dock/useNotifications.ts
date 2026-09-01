'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ImEventHandler } from '@/components/messaging/MessagingProvider';
import type { ImRealtimeEventKind } from '@/lib/messaging/events';

/* ============================================================================
   La escalera de notificación (§9 del plan), de menos a más intrusiva:

     1. Badge      → lo pinta el sidebar / el dock (siempre).
     2. Título     → prefijo "(N) " en document.title mientras haya menciones.
     3. Sonido     → dos tonos cortos por WebAudio (sin archivo), silenciable.
     4. Toast      → esquina, 6 s, enlaza al hilo.
     5. Escritorio → Notification API, SOLO tras permiso pedido con un botón.

   RGPD: el cuerpo de la notificación de escritorio NUNCA lleva datos de
   paciente ni el texto del mensaje. Solo "Ana te mencionó en #agenda".
   ========================================================================== */

const SOUND_KEY = 'futura.dock.sound';
const TOASTS_KEY = 'futura.dock.toasts';

/** Ventana de gracia tras montar: evita la ráfaga de sonidos al abrir el panel. */
const ARM_DELAY_MS = 2_500;

const TOAST_TTL_MS = 6_000;
const MAX_TOASTS = 3;

export type DesktopPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export interface NotifToast {
  id: string;
  title: string;
  /** Fragmento del mensaje. Solo se muestra dentro de la app, nunca en escritorio. */
  detail: string;
  channelId: string | null;
  tone: 'mention' | 'dm';
}

export interface NotificationsApi {
  soundEnabled: boolean;
  setSoundEnabled(v: boolean): void;
  toastsEnabled: boolean;
  setToastsEnabled(v: boolean): void;
  desktopPermission: DesktopPermission;
  requestDesktopPermission(): void;
  toasts: NotifToast[];
  dismissToast(id: string): void;
  clearToasts(): void;
}

function readFlag(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = window.localStorage.getItem(key);
    if (v === null) return fallback;
    return v === '1';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* localStorage bloqueado */
  }
}

/** Dos tonos cortos (~120 ms) generados en el momento. Sin archivo de audio. */
function playChime() {
  if (typeof window === 'undefined') return;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  try {
    const ctx = new Ctor();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    // Envolvente: ataque de 8 ms y caída exponencial. Nada de clics.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);

    const tones: Array<[number, number]> = [
      [880, 0],
      [1174.66, 0.06],
    ];
    for (const [freq, offset] of tones) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + offset);
      osc.connect(gain);
      osc.start(now + offset);
      osc.stop(now + offset + 0.07);
    }
    // Cerrar el contexto libera el hardware de audio del navegador.
    setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 400);
  } catch {
    /* autoplay bloqueado o WebAudio no disponible: se ignora */
  }
}

export function useNotifications(opts: {
  /** Cuando es false no se engancha nada: módulo sin cargar o degradado. */
  enabled: boolean;
  subscribe(kind: ImRealtimeEventKind | '*', handler: ImEventHandler): () => void;
  /** Menciones sin leer — alimenta el prefijo del título. */
  mentionCount: number;
  isDmChannel(channelId: string): boolean;
  isMutedChannel(channelId: string): boolean;
  channelName(channelId: string): string;
  /** users.id propio: lo que uno mismo escribe nunca suena. */
  myUserId: string | null;
}): NotificationsApi {
  const {
    enabled,
    subscribe,
    mentionCount,
    isDmChannel,
    isMutedChannel,
    channelName,
    myUserId,
  } = opts;

  const [soundEnabled, setSoundEnabledState] = useState(true);
  const [toastsEnabled, setToastsEnabledState] = useState(true);
  const [desktopPermission, setDesktopPermission] = useState<DesktopPermission>('unsupported');
  const [toasts, setToasts] = useState<NotifToast[]>([]);

  const armedRef = useRef(false);
  const soundRef = useRef(soundEnabled);
  const toastsRef = useRef(toastsEnabled);
  const permissionRef = useRef<DesktopPermission>('unsupported');
  const seq = useRef(0);

  soundRef.current = soundEnabled;
  toastsRef.current = toastsEnabled;
  permissionRef.current = desktopPermission;

  /* --- Preferencias (localStorage como respaldo local del usuario) ------- */
  useEffect(() => {
    setSoundEnabledState(readFlag(SOUND_KEY, true));
    setToastsEnabledState(readFlag(TOASTS_KEY, true));
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setDesktopPermission(Notification.permission as DesktopPermission);
    }
  }, []);

  const setSoundEnabled = useCallback((v: boolean) => {
    setSoundEnabledState(v);
    writeFlag(SOUND_KEY, v);
  }, []);

  const setToastsEnabled = useCallback((v: boolean) => {
    setToastsEnabledState(v);
    writeFlag(TOASTS_KEY, v);
  }, []);

  /* --- Permiso de escritorio: SOLO desde un botón, nunca al cargar ------- */
  const requestDesktopPermission = useCallback(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      void Notification.requestPermission().then((p) =>
        setDesktopPermission(p as DesktopPermission),
      );
    } catch {
      /* navegadores viejos con API por callback: se ignora */
    }
  }, []);

  /* --- Ventana de gracia al montar --------------------------------------- */
  useEffect(() => {
    const t = setTimeout(() => {
      armedRef.current = true;
    }, ARM_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  /* --- (a) Título de pestaña con contador -------------------------------- */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const titleEl = document.querySelector('title');
    if (!titleEl) return;

    const prefixFor = (n: number) => (n > 0 ? `(${n > 99 ? '99+' : n}) ` : '');
    const strip = (t: string) => t.replace(/^\(\d+\+?\)\s+/, '');

    let base = strip(document.title);
    let writing = false;

    const apply = () => {
      const next = `${prefixFor(mentionCount)}${base}`;
      if (document.title === next) return;
      writing = true;
      document.title = next;
      // El flag se baja en el próximo tick del observer.
      setTimeout(() => {
        writing = false;
      }, 0);
    };

    // Next reescribe <title> en cada navegación: hay que recapturar la base.
    const observer = new MutationObserver(() => {
      if (writing) return;
      base = strip(document.title);
      apply();
    });
    observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
    apply();

    return () => {
      observer.disconnect();
      // Al desmontar dejamos el título limpio.
      document.title = base;
    };
  }, [mentionCount]);

  /* --- Toasts ------------------------------------------------------------ */
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearToasts = useCallback(() => setToasts([]), []);

  const pushToast = useCallback(
    (toast: Omit<NotifToast, 'id'>) => {
      seq.current += 1;
      const id = `im-toast-${seq.current}`;
      setToasts((prev) => [...prev, { ...toast, id }].slice(-MAX_TOASTS));
      setTimeout(() => dismissToast(id), TOAST_TTL_MS);
    },
    [dismissToast],
  );

  /* --- (b/c/d) Reacción a los eventos ------------------------------------ */
  useEffect(() => {
    if (!enabled) return;

    /** Escritorio: título corto y cuerpo SIN datos de paciente ni cita textual. */
    const desktop = (title: string, body: string) => {
      if (permissionRef.current !== 'granted') return;
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
      try {
        new Notification(title, { body, tag: 'futura-mensajes', silent: true });
      } catch {
        /* algunos navegadores exigen ServiceWorker: se ignora */
      }
    };

    const offMention = subscribe('mention.new', (event) => {
      if (event.kind !== 'mention.new') return;
      if (!armedRef.current) return;
      if (isMutedChannel(event.channelId)) return;

      const who = event.senderName ?? 'Alguien';
      const where = event.channelName || channelName(event.channelId);
      if (soundRef.current) playChime();
      if (toastsRef.current) {
        pushToast({
          title: `${who} te mencionó en ${where}`,
          detail: (event.body ?? '').slice(0, 120),
          channelId: event.channelId,
          tone: 'mention',
        });
      }
      desktop('Te mencionaron', `${who} te mencionó en ${where}`);
    });

    const offMessage = subscribe('message.new', (event) => {
      if (event.kind !== 'message.new') return;
      if (!armedRef.current) return;
      if (!isDmChannel(event.channelId)) return;
      if (isMutedChannel(event.channelId)) return;
      // Los mensajes propios vuelven por el stream en algunas rutas: no suenan.
      if (myUserId && event.message.senderUserId === myUserId) return;

      const who = event.message.senderName ?? 'Mensaje directo';
      if (soundRef.current) playChime();
      if (toastsRef.current) {
        pushToast({
          title: `${who} te escribió`,
          detail: (event.message.body ?? '').slice(0, 120),
          channelId: event.channelId,
          tone: 'dm',
        });
      }
      desktop('Mensaje directo', `${who} te escribió por privado`);
    });

    return () => {
      offMention();
      offMessage();
    };
  }, [enabled, subscribe, pushToast, isDmChannel, isMutedChannel, channelName, myUserId]);

  return {
    soundEnabled,
    setSoundEnabled,
    toastsEnabled,
    setToastsEnabled,
    desktopPermission,
    requestDesktopPermission,
    toasts,
    dismissToast,
    clearToasts,
  };
}
