'use client';

import { Button } from '@/components/ui/button';
import { Loader2, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function OutboundDispatchButton({
  campaignId,
  disabled,
}: {
  campaignId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (!confirm('¿Lanzar la campaña? Retell empezará a llamar a los destinatarios pendientes.')) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/outbound/campaigns/${campaignId}/dispatch`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al lanzar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={onClick} disabled={loading || disabled}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Lanzar ahora
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
