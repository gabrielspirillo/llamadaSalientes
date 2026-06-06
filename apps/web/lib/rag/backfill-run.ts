/**
 * Backfill de embeddings RAG para FAQs y tratamientos existentes.
 *
 * Embebe todas las filas que aún no tienen embedding (idempotente). Se corre
 * UNA vez tras habilitar RAG; las nuevas/editadas se embeben solas en el
 * data layer. Las filas sin embedding igual funcionan (fallback a keyword).
 *
 * Uso (con el env de la app: OPENAI_API_KEY + DATABASE_URL):
 *   pnpm rag:backfill
 * En prod: docker exec <worker> sh -lc \
 *   './node_modules/.bin/tsx --import ./worker/preload.ts lib/rag/backfill-run.ts'
 */
import { backfillEmbeddings } from '@/lib/rag/embeddings';

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('✗ Falta OPENAI_API_KEY');
    process.exit(1);
  }
  console.log('[rag:backfill] embebiendo FAQs/tratamientos sin embedding…');
  const result = await backfillEmbeddings();
  console.log('[rag:backfill] listo', result);
  process.exit(0);
}

main().catch((err) => {
  console.error('[rag:backfill] crasheó', err);
  process.exit(1);
});
