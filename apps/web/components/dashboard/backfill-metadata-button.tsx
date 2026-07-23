'use client';

import { Button } from '@/components/ui/button';
import { History, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type BackfillResult = {
  scanned: number;
  fromEvents: number;
  fromRetell: number;
  unresolved: number;
};

/**
 * Dispara /api/admin/backfill-call-metadata para recuperar número, fecha y
 * duración de llamadas viejas (las que quedaron incompletas por el bug del
 * webhook que pisaba columnas con NULL).
 */
export function BackfillMetadataButton({ pending }: { pending: number }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BackfillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (pending === 0 && !result) return null;

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/backfill-call-metadata', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Error ${res.status}`);
      }
      setResult((await res.json()) as BackfillResult);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
    setLoading(false);
  }

  const recovered = result ? result.fromEvents + result.fromRetell : 0;

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      {result && !error && (
        <span className="text-xs text-emerald-700">
          ✓ {recovered} recuperadas
          {result.unresolved > 0 ? ` · ${result.unresolved} sin datos` : ''}
        </span>
      )}
      <Button variant="secondary" size="sm" onClick={run} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
        {loading ? 'Recuperando…' : `Recuperar datos (${pending})`}
      </Button>
    </div>
  );
}
