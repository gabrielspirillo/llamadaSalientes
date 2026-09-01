'use client';

import { Button } from '@/components/ui/button';
import { CheckCircle2, Loader2, Zap } from 'lucide-react';
import { useState, useTransition } from 'react';
import { activateClinicAction } from './actions';

export function ActivateButton({ tenantId, active }: { tenantId: string; active: boolean }) {
  const [isActive, setIsActive] = useState(active);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (isActive) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
        <CheckCircle2 className="h-4 w-4" />
        Activa
      </span>
    );
  }

  function activate() {
    setError(null);
    startTransition(async () => {
      const r = await activateClinicAction(tenantId);
      if (r.ok) setIsActive(true);
      else setError(r.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" size="sm" onClick={activate} disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
        Activar
      </Button>
      {error && <span className="text-[12px] text-rose-600">{error}</span>}
    </div>
  );
}
