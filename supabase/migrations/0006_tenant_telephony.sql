-- ─────────────────────────────────────────────────────────────────────────────
-- Tenant telephony: configuración Twilio por-tenant para que cada clínica
-- mantenga su número público (Caller ID saliente) y reciba llamadas por su
-- propio número Twilio (con desvío configurado en su operador).
--
-- Objetivo:
--   1. Salientes con caller-ID = número de la clínica
--      → guardamos las credenciales Twilio del tenant + el SID del
--        "Verified Caller ID" devuelto por Twilio cuando confirmaron
--        propiedad del número.
--   2. Entrantes al número de la clínica → ruteadas a Twilio
--      → el operador de la clínica desvía a un número Twilio dedicado
--        que asignamos por tenant; ese DID tiene VoiceUrl apuntando a
--        nuestro webhook que reconoce el tenant por el "To" recibido.
--
-- Credenciales Twilio van cifradas con AES-256-GCM (mismo formato que
-- whatsapp_connections.cloud_access_token_enc o ghl_integrations.access_token_enc).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "tenant_telephony" (
  "tenant_id" uuid PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,

  -- Subaccount Twilio del tenant.
  "twilio_account_sid" text,
  "twilio_auth_token_enc" text,

  -- Caller ID saliente: número público de la clínica.
  "caller_id_e164" text,
  "caller_id_sid" text,                  -- "PNxxxx" devuelto por Twilio (resource OutgoingCallerIds)
  "caller_id_verified_at" timestamptz,

  -- Número Twilio dedicado a entrantes (la clínica desvía las llamadas hacia acá).
  "inbound_number_e164" text,
  "inbound_number_sid" text,             -- "PNxxxx" del IncomingPhoneNumber
  "inbound_configured_at" timestamptz,

  -- Hacia dónde enrutar las entrantes: 'agent' (Retell) | 'forward' (transferir a un humano)
  "inbound_route" text NOT NULL DEFAULT 'agent',
  "inbound_forward_number" text,         -- usado si inbound_route='forward' o como fallback

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Lookup por el número Twilio entrante (webhook /api/twilio/inbound-voice
-- recibe el To y debe resolver el tenant).
CREATE UNIQUE INDEX "tenant_telephony_inbound_number_unique"
  ON "tenant_telephony" ("inbound_number_e164")
  WHERE "inbound_number_e164" IS NOT NULL;

-- Lookup por caller_id (analytics / debug).
CREATE INDEX "tenant_telephony_caller_id_idx"
  ON "tenant_telephony" ("caller_id_e164")
  WHERE "caller_id_e164" IS NOT NULL;
