'use client';

import { Button } from '@/components/ui/button';
import { startImpersonationAction } from '@/lib/impersonation-actions';
import { Loader2, LogIn } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export function EnterButton({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function enter() {
    setError(null);
    startTransition(async () => {
      const r = await startImpersonationAction(tenantId);
      if (r.ok) {
        router.push('/dashboard');
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="secondary" size="sm" onClick={enter} disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
        Gestionar
      </Button>
      {error && <span className="text-[12px] text-rose-600">{error}</span>}
    </div>
  );
}
