-- ─────────────────────────────────────────────────────────────────────────────
-- WhatsApp module: connections (Cloud + Evolution), contacts, conversations,
-- messages. Multi-tenant (tenant_id en cada tabla). Tokens cifrados a nivel
-- aplicación con AES-256-GCM (lib/crypto.ts).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "whatsapp_mode" AS ENUM ('CLOUD', 'EVOLUTION');
CREATE TYPE "whatsapp_status" AS ENUM ('PENDING', 'CONNECTED', 'DISCONNECTED', 'ERROR');
CREATE TYPE "conversation_channel" AS ENUM ('WHATSAPP_CLOUD', 'WHATSAPP_EVOLUTION');
CREATE TYPE "conversation_status" AS ENUM ('ACTIVE', 'HANDOFF', 'CLOSED');
CREATE TYPE "message_direction" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "message_sender" AS ENUM ('CONTACT', 'AGENT', 'HUMAN', 'SYSTEM');
CREATE TYPE "message_delivery_status" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');
CREATE TYPE "message_type" AS ENUM (
  'TEXT', 'AUDIO', 'IMAGE', 'PDF', 'VIDEO', 'STICKER',
  'LOCATION', 'CONTACT', 'TEMPLATE', 'INTERACTIVE', 'SYSTEM'
);

-- Una fila por (tenant, mode). Tenant puede tener ambos drivers configurados
-- (ej: piloto con Evolution + prod con Cloud).
CREATE TABLE "whatsapp_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "mode" "whatsapp_mode" NOT NULL,
  "status" "whatsapp_status" NOT NULL DEFAULT 'PENDING',
  "qr_b64" text,
  "waba_id" text,
  "phone_id" text,
  "cloud_access_token_enc" text,
  "cloud_app_secret_enc" text,
  "evolution_instance" text,
  "evolution_token_enc" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "whatsapp_connections_tenant_mode_unique" UNIQUE ("tenant_id", "mode")
);
-- Evolution instance debe ser global-unique (es el id en el server Evolution).
CREATE UNIQUE INDEX "whatsapp_connections_evolution_instance_uniq"
  ON "whatsapp_connections" ("evolution_instance")
  WHERE "evolution_instance" IS NOT NULL;
CREATE INDEX "whatsapp_connections_phone_id_idx" ON "whatsapp_connections" ("phone_id");
CREATE INDEX "whatsapp_connections_tenant_status_idx" ON "whatsapp_connections" ("tenant_id", "status");

-- Contactos WhatsApp (separados de patients_cache para no acoplar con GHL).
-- Si conocemos el patient via GHL, guardamos su id en ghl_contact_id.
CREATE TABLE "whatsapp_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "phone_e164" text NOT NULL,
  "name" text,
  "ghl_contact_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "whatsapp_contacts_tenant_phone_unique" UNIQUE ("tenant_id", "phone_e164")
);
CREATE INDEX "whatsapp_contacts_ghl_idx" ON "whatsapp_contacts" ("tenant_id", "ghl_contact_id");

CREATE TABLE "whatsapp_conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "whatsapp_contacts"("id") ON DELETE CASCADE,
  "channel" "conversation_channel" NOT NULL,
  "status" "conversation_status" NOT NULL DEFAULT 'ACTIVE',
  "urgent_flag" boolean NOT NULL DEFAULT false,
  "last_msg_at" timestamptz,
  "assigned_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "human_takeover_at" timestamptz,
  "human_takeover_until" timestamptz,
  "last_human_msg_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "whatsapp_conversations_tenant_status_idx"
  ON "whatsapp_conversations" ("tenant_id", "status");
CREATE INDEX "whatsapp_conversations_tenant_last_msg_idx"
  ON "whatsapp_conversations" ("tenant_id", "last_msg_at");
CREATE INDEX "whatsapp_conversations_contact_idx" ON "whatsapp_conversations" ("contact_id");

CREATE TABLE "whatsapp_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "conversation_id" uuid NOT NULL REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE,
  "external_id" text,
  "direction" "message_direction" NOT NULL,
  "type" "message_type" NOT NULL DEFAULT 'TEXT',
  "sender_type" "message_sender" NOT NULL DEFAULT 'CONTACT',
  "sender_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "delivery_status" "message_delivery_status",
  "failure_reason" text,
  "internal_note" boolean NOT NULL DEFAULT false,
  "client_nonce" uuid,
  "content_text" text,
  "media_url" text,
  "media_type" text,
  "transcription" text,
  "media_analysis_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "raw_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "whatsapp_messages_conv_external_unique" UNIQUE ("conversation_id", "external_id"),
  CONSTRAINT "whatsapp_messages_conv_nonce_unique" UNIQUE ("conversation_id", "client_nonce")
);
CREATE INDEX "whatsapp_messages_tenant_conv_created_idx"
  ON "whatsapp_messages" ("tenant_id", "conversation_id", "created_at");
CREATE INDEX "whatsapp_messages_tenant_sender_created_idx"
  ON "whatsapp_messages" ("tenant_id", "sender_type", "created_at");
