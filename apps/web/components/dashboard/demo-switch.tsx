'use client';

import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';
import * as React from 'react';

/**
 * "Ver ejemplo" sin ir al servidor: el panel se renderiza dos veces en el
 * servidor (datos reales y datos de muestra, que son fijos y no tocan la
 * base) y aquí se elige cuál se pinta. Antes era un enlace a `?demo=1` que
 * re-ejecutaba el layout y la página enteros: se leía como una recarga.
 * La URL se mantiene en sincronía (`?demo=1`) por si se comparte.
 */

type Mode = 'real' | 'demo';
const DemoContext = React.createContext<{ mode: Mode; setMode: (m: Mode) => void } | null>(null);

export function DemoSwitch({
  initialDemo,
  real,
  demo,
}: {
  initialDemo: boolean;
  real: React.ReactNode;
  demo: React.ReactNode;
}) {
  const [mode, setModeState] = React.useState<Mode>(initialDemo ? 'demo' : 'real');
  const setMode = React.useCallback((m: Mode) => {
    setModeState(m);
    try {
      const url = new URL(window.location.href);
      if (m === 'demo') url.searchParams.set('demo', '1');
      else url.searchParams.delete('demo');
      window.history.replaceState(window.history.state, '', url.toString());
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      /* sin ventana (SSR) no hay nada que sincronizar */
    }
  }, []);
  const value = React.useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return (
    <DemoContext.Provider value={value}>
      {/* La clave cambia con el modo: el contenido entra con su animación. */}
      <div key={mode} className="animate-rise">
        {mode === 'demo' ? demo : real}
      </div>
    </DemoContext.Provider>
  );
}

export function DemoToggle({ to, children }: { to: Mode; children?: React.ReactNode }) {
  const ctx = React.useContext(DemoContext);
  return (
    <Button
      variant="secondary"
      onClick={() => ctx?.setMode(to)}
      className="press"
      aria-pressed={ctx?.mode === to}
    >
      {children ??
        (to === 'demo' ? (
          <>
            <Sparkles className="h-4 w-4" /> Ver ejemplo
          </>
        ) : (
          'Salir del ejemplo'
        ))}
    </Button>
  );
}
