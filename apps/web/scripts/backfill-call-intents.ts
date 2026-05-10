// Re-procesa llamadas que tienen transcript cifrado pero intent=null.
// Útil después de cambios en el pipeline de summarización para llenar datos viejos.
import { createDecipheriv } from 'node:crypto';
import path from 'node:path';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../lib/db/schema';
import { calls } from '../lib/db/schema';

config({ path: path.resolve(__dirname, '../.env.local') });

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
function decrypt(payload: string): string {
  const raw = process.env.ENCRYPTION_KEY!;
  const key = Buffer.from(raw, 'base64');
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_BYTES);
  const authTag = buf.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const dec = createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(authTag);
  return Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');
}

const SUMMARY_SYSTEM = `Eres un analista de conversaciones telefónicas de una clínica dental.
Recibís el transcript completo. Devolvés EXCLUSIVAMENTE un JSON válido sin markdown:
{
  "intent": "agendar" | "reagendar" | "cancelar" | "consulta" | "queja" | "otro",
  "sentiment": "positivo" | "neutro" | "negativo",
  "summary": "2-3 frases en ESPAÑOL describiendo qué pasó (NUNCA en inglés)",
  "followUp": null o string corto con acción pendiente
}`;

async function gemini(transcript: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Falta GEMINI_API_KEY en .env.local');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SUMMARY_SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: `Transcript:\n${transcript.slice(0, 8000)}` }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}') as {
    intent?: string;
    sentiment?: string;
    summary?: string;
    followUp?: string | null;
  };
}

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 30 });
  const db = drizzle(sql, { schema });

  try {
    // Llamadas con transcript pero sin intent
    const rows = await db
      .select({
        id: calls.id,
        retellCallId: calls.retellCallId,
        transcriptEnc: calls.transcriptEnc,
        summary: calls.summary,
        intent: calls.intent,
      })
      .from(calls)
      .where(and(isNotNull(calls.transcriptEnc), isNull(calls.intent)));

    console.log(`📋 ${rows.length} llamadas para procesar`);

    let ok = 0;
    let fail = 0;
    for (const r of rows) {
      try {
        if (!r.transcriptEnc) continue;
        const transcript = decrypt(r.transcriptEnc);
        if (transcript.trim().length < 20) {
          console.log(`  ⏭️  ${r.retellCallId.slice(0, 22)}: transcript muy corto, skip`);
          continue;
        }

        const ai = await gemini(transcript);
        await db
          .update(calls)
          .set({
            intent: ai.intent ?? 'otro',
            sentiment: ai.sentiment ?? null,
            summary: ai.summary ?? r.summary,
          })
          .where(eq(calls.id, r.id));

        console.log(
          `  ✅ ${r.retellCallId.slice(0, 22)}: intent=${ai.intent}, sentiment=${ai.sentiment}`,
        );
        ok++;
      } catch (err) {
        console.error(`  ❌ ${r.retellCallId.slice(0, 22)}:`, err instanceof Error ? err.message : err);
        fail++;
      }
    }

    console.log(`\n📊 Listo: ${ok} ok, ${fail} fail`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
