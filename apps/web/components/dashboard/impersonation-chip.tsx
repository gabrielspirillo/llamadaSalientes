'use client';

import { stopImpersonationAction } from '@/lib/impersonation-actions';
import { Eye, Loader2, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/**
 * El único indicador de que Futura está dentro de una clínica. Vive en el
 * topbar (que es fijo), en color de aviso y con la salida a mano: antes había
 * un banner que se iba al hacer scroll y un chip verde que se confundía con
 * el estado "en línea".
 */
export function ImpersonationChip({ clinicName }: { clinicName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function exit() {
    startTransition(async () => {
      await stopImpersonationAction();
      router.push('/dashboard/futura');
      router.refresh();
    });
  }

  // Cristal sobre la cápsula verde con un punto ámbar de aviso (el chip
  // amarillo macizo chocaba con el verde y en móvil pisaba el logo). En móvil
  // ocupa el sitio del logo (topbar.tsx), con el nombre de la clínica.
  return (
    <output
      className="inline-flex min-w-0 max-w-[340px] items-center gap-1.5 rounded-full bg-white/12 py-1 pl-1 pr-1 text-[12px] font-semibold text-white ring-1 ring-white/30 sm:pl-1.5"
      title={`Estás gestionando ${clinicName} como Futura`}
    >
      <span className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-300 text-amber-950">
        <Eye className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="min-w-0 truncate">
        <span className="hidden font-medium text-white/75 sm:inline">Gestionando </span>
        <span className="sr-only sm:hidden">Gestionando </span>
        {clinicName}
      </span>
      <button
        type="button"
        onClick={exit}
        disabled={pending}
        aria-label="Salir de la cuenta del cliente"
        title="Volver al panel de Futura (no cierra tu sesión)"
        className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-white px-2 text-[12px] font-semibold text-brand-800 transition-colors hover:bg-white/90 disabled:opacity-60 sm:px-2.5"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <LogOut className="h-3.5 w-3.5" />
        )}
        <span className="hidden sm:inline">Salir</span>
      </button>
    </output>
  );
}
