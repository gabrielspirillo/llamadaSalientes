-- ─────────────────────────────────────────────────────────────────────────────
-- Tenant telephony: agregar provider (twilio|zadarma) y credenciales Zadarma.
--
-- Objetivo:
--   - Cada tenant elige UN provider de telefonía (Twilio o Zadarma).
--   - Los campos compartidos (caller_id_e164, inbound_number_e164,
--     inbound_route, inbound_forward_number) son agnósticos del provider y
--     ya existen.
--   - Los SIDs y credenciales son provider-específicos.
--
-- Zadarma:
--   - user_key + secret se generan en cabinet.zadarma.com → API
--   - Auth REST: HMAC-SHA1(secret, method + sorted_params + md5(sorted_params))
--   - Webhooks (NOTIFY_*) firman con md5(payload + api_secret) en algunos
--     eventos; el "webhook signature key" puede ser distinto al api secret
--     (se configura en cabinet → Settings → API), por eso lo guardamos
--     opcionalmente como zadarma_webhook_secret_enc.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "tenant_telephony"
  ADD COLUMN "provider" text NOT NULL DEFAULT 'twilio';

ALTER TABLE "tenant_telephony"
  ADD CONSTRAINT "tenant_telephony_provider_check"
  CHECK ("provider" IN ('twilio', 'zadarma'));

ALTER TABLE "tenant_telephony"
  ADD COLUMN "zadarma_user_key" text,
  ADD COLUMN "zadarma_secret_enc" text,
  -- Firma de NOTIFY_* webhooks. Si NULL, no verificamos firma.
  ADD COLUMN "zadarma_webhook_secret_enc" text;

-- Cuando el provider es Zadarma el caller_id_sid / inbound_number_sid no
-- aplican (Zadarma maneja "direct numbers" por número, no por SID). Quedan
-- como NULL en ese caso. No agregamos columnas nuevas para no duplicar
-- conceptos.

-- Lookup por provider (futuras analíticas: distribución de tenants).
CREATE INDEX "tenant_telephony_provider_idx"
  ON "tenant_telephony" ("provider");
