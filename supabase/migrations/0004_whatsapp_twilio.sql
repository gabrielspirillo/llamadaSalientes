-- ─────────────────────────────────────────────────────────────────────────────
-- WhatsApp Twilio (BSP oficial). Tercer driver además de Cloud y Evolution.
-- Twilio actúa como Business Solution Provider de Meta: provee número WhatsApp
-- aprobado + REST API propia. Credenciales por-tenant: Account SID + Auth Token
-- (cifrado) + número remitente E.164.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Extender enums. ALTER TYPE ... ADD VALUE soporta IF NOT EXISTS desde PG12.
--    No usamos el nuevo valor en la misma transacción → seguro.
ALTER TYPE "whatsapp_mode" ADD VALUE IF NOT EXISTS 'TWILIO';
ALTER TYPE "conversation_channel" ADD VALUE IF NOT EXISTS 'WHATSAPP_TWILIO';

-- 2) Columnas específicas de Twilio en whatsapp_connections.
ALTER TABLE "whatsapp_connections"
  ADD COLUMN IF NOT EXISTS "twilio_account_sid" text,
  ADD COLUMN IF NOT EXISTS "twilio_auth_token_enc" text,
  ADD COLUMN IF NOT EXISTS "twilio_from_number" text;

-- 3) Lookup por sender al recibir webhook (To = nuestro from-number).
CREATE INDEX IF NOT EXISTS "whatsapp_connections_twilio_from_idx"
  ON "whatsapp_connections" ("twilio_from_number")
  WHERE "twilio_from_number" IS NOT NULL;
