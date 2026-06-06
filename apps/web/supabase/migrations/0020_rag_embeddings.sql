-- RAG: embeddings para FAQs y tratamientos (text-embedding-3-small, 1536 floats).
-- Sin pgvector: guardamos el vector como jsonb y hacemos coseno en memoria (el
-- set por tenant es chico). Null = sin embeber todavía → fallback a keyword.
ALTER TABLE faqs ADD COLUMN IF NOT EXISTS embedding jsonb;
ALTER TABLE treatments ADD COLUMN IF NOT EXISTS embedding jsonb;
