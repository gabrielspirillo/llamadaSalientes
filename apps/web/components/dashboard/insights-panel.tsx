'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTopbar } from '@/components/ui/card';
import {
  AlertTriangle,
  Lightbulb,
  Loader2,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useState } from 'react';

type Insights = {
  topPatterns: string[];
  alerts: string[];
  promptSuggestions: string[];
  message?: string;
};

export function InsightsPanel() {
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/insights');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Error ${res.status}`);
      }
      const json = (await res.json()) as Insights;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al generar insights');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardTopbar
        icon={<Sparkles className="h-4 w-4" />}
        tone="grape"
        title="Insights con IA"
        subtitle="Patrones, alertas y mejoras al prompt del agente"
        action={<Badge tone="violet">Gemini</Badge>}
      />
      <div className="px-5 pb-5 sm:px-6 sm:pb-6">

        {!data && !loading && !error && (
          <Button size="sm" className="w-full" onClick={generate}>
            <Sparkles className="h-4 w-4" />
            Generar insights
          </Button>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Analizando últimas 50 llamadas…
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
            {error}
          </div>
        )}

        {data && data.message && (
          <p className="text-sm text-zinc-500 italic">{data.message}</p>
        )}

        {data && !data.message && (
          <div className="space-y-5">
            {data.topPatterns.length > 0 && (
              <Section
                icon={<TrendingUp className="h-3.5 w-3.5 text-blue-600" />}
                title="Patrones detectados"
              >
                {data.topPatterns.map((p) => (
                  <li key={p} className="text-sm text-zinc-700">
                    {p}
                  </li>
                ))}
              </Section>
            )}

            {data.alerts.length > 0 && (
              <Section
                icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
                title="Alertas"
              >
                {data.alerts.map((a) => (
                  <li key={a} className="text-sm text-zinc-700">
                    {a}
                  </li>
                ))}
              </Section>
            )}

            {data.promptSuggestions.length > 0 && (
              <Section
                icon={<Lightbulb className="h-3.5 w-3.5 text-violet-600" />}
                title="Sugerencias para el prompt"
              >
                {data.promptSuggestions.map((s) => (
                  <li key={s} className="text-sm text-zinc-700">
                    {s}
                  </li>
                ))}
              </Section>
            )}

            <Button variant="ghost" size="sm" onClick={generate} className="w-full">
              <Sparkles className="h-3.5 w-3.5" /> Regenerar
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">{title}</p>
      </div>
      <ul className="list-disc space-y-1.5 pl-5 text-[13px] marker:text-brand-300">{children}</ul>
    </div>
  );
}
