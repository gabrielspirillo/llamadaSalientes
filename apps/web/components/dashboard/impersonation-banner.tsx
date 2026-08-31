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
    <div className="flex items-center justify-between gap-3 bg-violet-600 px-4 py-2 text-sm text-white sm:px-6">
      <span className="inline-flex min-w-0 items-center gap-2">
        <Eye className="h-4 w-4 shrink-0" />
        <span className="truncate">
          Estás gestionando <strong className="font-semibold">{clinicName}</strong> como Futura.
        </span>
      </span>
      <button
        type="button"
        onClick={exit}
        disabled={pending}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-white/15 px-2.5 py-1 font-medium transition-colors hover:bg-white/25 disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
        Salir
      </button>
    </div>
  );
}
