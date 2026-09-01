'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/* ============================================================================
   Preferencias de aviso, persistidas en el servidor.

   Antes vivían solo en localStorage, así que no viajaban de un dispositivo a
   otro y —lo importante— el worker no podía leerlas: el escalado del aviso
   fuera del panel era inalcanzable porque nadie escribía nunca la tabla.
   ========================================================================== */

export interface MessagingSettings {
  sound: boolean;
  desktopPush: boolean;
  dndFrom: string | null;
  dndTo: string | null;
  escalateMentionsAfterMinutes: number;
  statusEmoji: string | null;
  statusText: string | null;
  statusUntil: string | null;
}

const DEFAULTS: MessagingSettings = {
  sound: true,
  desktopPush: true,
  dndFrom: null,
  dndTo: null,
  escalateMentionsAfterMinutes: 0,
  statusEmoji: null,
  statusText: null,
  statusUntil: null,
};

export interface MessagingSettingsApi {
  settings: MessagingSettings;
  loading: boolean;
  saving: boolean;
  /** null mientras no haya fallado nada. */
  error: string | null;
  update(patch: Partial<MessagingSettings>): void;
}

export function useMessagingSettings(enabled: boolean): MessagingSettingsApi {
  const [settings, setSettings] = useState<MessagingSettings>(DEFAULTS);
  const [loading, setLoading] = useState(enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Partial<MessagingSettings>>({});

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/messages/settings', { cache: 'no-store' });
        if (!res.ok) throw new Error('no disponible');
        const data = (await res.json()) as { settings?: MessagingSettings };
        if (!cancelled && data.settings && mountedRef.current) setSettings(data.settings);
      } catch {
        // Sin preferencias del servidor se opera con los defectos: que no se
        // puedan leer no debe impedir usar el módulo.
      } finally {
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const flush = useCallback(async () => {
    const patch = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/messages/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = (await res.json().catch(() => ({}))) as {
        settings?: MessagingSettings;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'No se pudo guardar');
      if (data.settings && mountedRef.current) setSettings(data.settings);
    } catch (err) {
      if (mountedRef.current) setError((err as Error).message);
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, []);

  // Optimista y con freno: mover un selector no debe disparar una petición por
  // cada tecla, pero el interruptor tiene que responder en el acto.
  const update = useCallback(
    (patch: Partial<MessagingSettings>) => {
      setSettings((prev) => ({ ...prev, ...patch }));
      pendingRef.current = { ...pendingRef.current, ...patch };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), 400);
    },
    [flush],
  );

  return { settings, loading, saving, error, update };
}

/** Opciones del margen de escalado. 0 = no avisar fuera del panel. */
export const ESCALATE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: 'No avisar' },
  { value: 15, label: 'A los 15 minutos' },
  { value: 30, label: 'A la media hora' },
  { value: 60, label: 'A la hora' },
  { value: 120, label: 'A las dos horas' },
];
