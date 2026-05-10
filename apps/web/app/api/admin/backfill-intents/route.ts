import { decrypt } from '@/lib/crypto';
import { db } from '@/lib/db/client';
import { calls } from '@/lib/db/schema';
import { summarizeCallWithGemini } from '@/lib/gemini/client';
import { getCurrentTenant } from '@/lib/tenant';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min max

/**
 * Re-procesa llamadas viejas con transcript pero sin intent.
 * Útil para llenar datos generados antes de wirear Gemini en el webhook.
 *
 * Solo el owner del tenant logueado puede ejecutarlo.
 */
export async function POST(_req: NextRequest) {
  let tenantId: string;
  try {
    const ctx = await getCurrentTenant();
    tenantId = ctx.tenant.id;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: 'GEMINI_API_KEY no configurada' }, { status: 503 });
  }

  const rows = await db
    .select({
      id: calls.id,
      retellCallId: calls.retellCallId,
      transcriptEnc: calls.transcriptEnc,
      summary: calls.summary,
    })
    .from(calls)
    .where(
      and(eq(calls.tenantId, tenantId), isNotNull(calls.transcriptEnc), isNull(calls.intent)),
    )
    .limit(50);

  const results: Array<{
    id: string;
    ok: boolean;
    intent?: string;
    error?: string;
  }> = [];

  for (const r of rows) {
    try {
      if (!r.transcriptEnc) continue;
      const transcript = decrypt(r.transcriptEnc);
      if (transcript.trim().length < 20) {
        results.push({ id: r.id, ok: false, error: 'transcript muy corto' });
        continue;
      }
      const ai = await summarizeCallWithGemini(transcript);
      await db
        .update(calls)
        .set({
          intent: ai.intent ?? 'otro',
          sentiment: ai.sentiment ?? null,
          summary: ai.summary ?? r.summary,
        })
        .where(eq(calls.id, r.id));
      results.push({ id: r.id, ok: true, intent: ai.intent });
    } catch (err) {
      results.push({ id: r.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  return NextResponse.json({
    processed: rows.length,
    ok,
    fail: results.length - ok,
    results,
  });
}
