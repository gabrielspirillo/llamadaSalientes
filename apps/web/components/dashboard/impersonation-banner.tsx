'use client';

import { stopImpersonationAction } from '@/lib/impersonation-actions';
import { Eye, Loader2, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export function ImpersonationBanner({ clinicName }: { clinicName: string }) {
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
    <div className="relative flex items-center justify-between gap-3 overflow-hidden bg-[linear-gradient(100deg,#7139e8,#a855f7_55%,#ec4899)] px-4 py-2.5 text-[13px] text-white sm:px-6">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(100deg,transparent,rgba(255,255,255,0.18),transparent)] bg-[length:200%_100%] animate-shimmer"
      />
      <span className="relative inline-flex min-w-0 items-center gap-2">
        <Eye className="h-4 w-4 shrink-0" />
        <span className="truncate">
          Estás gestionando <strong className="font-semibold">{clinicName}</strong> como Futura.
        </span>
      </span>
      <button
        type="button"
        onClick={exit}
        disabled={pending}
        className="relative inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 font-semibold backdrop-blur-sm transition-all duration-300 hover:bg-white/30 active:scale-95 disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <LogOut className="h-3.5 w-3.5" />
        )}
        Salir
      </button>
    </div>
  );
}
