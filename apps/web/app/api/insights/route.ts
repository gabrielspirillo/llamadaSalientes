import { listCalls } from '@/lib/data/calls-list';
import { generateCallInsights } from '@/lib/gemini/client';
import { getCurrentTenant } from '@/lib/tenant';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Genera insights con IA (Gemini) sobre las últimas N llamadas del tenant.
 * Heavy-ish, así que se llama on-demand desde el cliente.
 */
export async function GET(_req: NextRequest) {
  let tenantId: string;
  try {
    const ctx = await getCurrentTenant();
    tenantId = ctx.tenant.id;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: 'Gemini no configurado' }, { status: 503 });
  }

  // Últimas 50 llamadas del tenant
  const recent = await listCalls(tenantId, 50);
  if (recent.length === 0) {
    return NextResponse.json({
      topPatterns: [],
      alerts: [],
      promptSuggestions: [],
      message: 'Sin datos suficientes',
    });
  }

  const intentCounts = new Map<string, number>();
  const sentimentCounts = new Map<string, number>();
  for (const c of recent) {
    const ik = c.intent ?? 'sin_clasificar';
    intentCounts.set(ik, (intentCounts.get(ik) ?? 0) + 1);
    const sk = c.sentiment ?? 'sin_clasificar';
    sentimentCounts.set(sk, (sentimentCounts.get(sk) ?? 0) + 1);
  }

  const insights = await generateCallInsights({
    totalCalls: recent.length,
    byIntent: Array.from(intentCounts, ([intent, count]) => ({ intent, count })),
    bySentiment: Array.from(sentimentCounts, ([sentiment, count]) => ({ sentiment, count })),
    recentSummaries: recent
      .map((c) => c.summary)
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .slice(0, 20),
  });

  return NextResponse.json(insights);
}
