-- ─────────────────────────────────────────────────────────────────────────────
-- WhatsApp inbox: features tipo Chatwoot
-- - ai_enabled: flag por conversación para pausar/reanudar al agente IA.
-- - whatsapp_tags / whatsapp_conversation_tags: etiquetado de conversaciones.
-- - whatsapp_quick_replies: respuestas rápidas accesibles con "/" en el composer.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Flag de agente IA por conversación. Por defecto ON para no romper
--    integraciones externas (n8n / GHL) que asumen agente activo.
ALTER TABLE "whatsapp_conversations"
  ADD COLUMN IF NOT EXISTS "ai_enabled" boolean NOT NULL DEFAULT true;

-- 2) Tags por tenant.
CREATE TABLE IF NOT EXISTS "whatsapp_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "color" text NOT NULL DEFAULT '#71717a',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "whatsapp_tags_tenant_label_unique" UNIQUE ("tenant_id", "label")
);
CREATE INDEX IF NOT EXISTS "whatsapp_tags_tenant_idx" ON "whatsapp_tags" ("tenant_id");

-- 3) Tabla puente conversación <-> tag.
CREATE TABLE IF NOT EXISTS "whatsapp_conversation_tags" (
  "conversation_id" uuid NOT NULL REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE,
  "tag_id" uuid NOT NULL REFERENCES "whatsapp_tags"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("conversation_id", "tag_id")
);
CREATE INDEX IF NOT EXISTS "whatsapp_conversation_tags_tag_idx"
  ON "whatsapp_conversation_tags" ("tag_id");

-- 4) Respuestas rápidas (canned responses) por tenant. shortcut único por tenant.
CREATE TABLE IF NOT EXISTS "whatsapp_quick_replies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "shortcut" text NOT NULL,
  "text" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "whatsapp_quick_replies_tenant_shortcut_unique" UNIQUE ("tenant_id", "shortcut")
);
CREATE INDEX IF NOT EXISTS "whatsapp_quick_replies_tenant_idx"
  ON "whatsapp_quick_replies" ("tenant_id");
