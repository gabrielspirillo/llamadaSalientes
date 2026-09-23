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

  return (
    <output
      className="inline-flex max-w-[260px] items-center gap-1.5 rounded-full bg-amber-300 py-1 pl-3 pr-1 text-[12px] font-semibold text-amber-950 ring-2 ring-amber-200/70"
      title={`Estás gestionando ${clinicName} como Futura`}
    >
      <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">
        <span className="hidden sm:inline">Gestionando </span>
        {clinicName}
      </span>
      <button
        type="button"
        onClick={exit}
        disabled={pending}
        aria-label="Salir de la clínica"
        className="ml-1 inline-flex h-7 items-center gap-1 rounded-full bg-amber-950/90 px-2.5 text-[12px] font-semibold text-amber-50 transition-colors hover:bg-amber-950 disabled:opacity-60"
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
