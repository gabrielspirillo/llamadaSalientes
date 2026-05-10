'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, Wand2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Botón que dispara /api/admin/backfill-intents.
 * Visible solo cuando hay llamadas con transcript pero sin motivo extraído.
 */
export function BackfillButton({ pending }: { pending: number }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: number; fail: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (pending === 0 && !result) return null;

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/backfill-intents', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Error ${res.status}`);
      }
      const data = (await res.json()) as { ok: number; fail: number };
      setResult({ ok: data.ok, fail: data.fail });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
    setLoading(false);
  }

  return (
    <Card>
      <div className="p-5">
        <div className="flex items-center gap-2 mb-2">
          <Wand2 className="h-4 w-4 text-violet-600" />
          <h3 className="text-sm font-semibold tracking-tight">Procesar llamadas pendientes</h3>
        </div>
        <p className="text-xs text-zinc-500 mb-4">
          {pending} llamada{pending === 1 ? '' : 's'} con transcripción pero sin motivo. Pasalas
          por Gemini para clasificar y resumir en español.
        </p>
        {error && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1.5 mb-3">
            {error}
          </p>
        )}
        {result && (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1.5 mb-3">
            ✓ {result.ok} procesadas{result.fail > 0 ? ` · ${result.fail} fallos` : ''}
          </p>
        )}
        <Button size="sm" onClick={run} disabled={loading || pending === 0} className="w-full">
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {loading ? 'Procesando…' : `Procesar ${pending}`}
        </Button>
      </div>
    </Card>
  );
}
