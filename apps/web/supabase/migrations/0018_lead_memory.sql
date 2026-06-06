-- Memoria unificada por lead, cross-canal (WhatsApp + llamadas in/out).
-- Keyed por (tenant_id, phone_e164) — la llave universal entre los canales.
-- profile_summary = resumen rolling inyectado al agente; facts = hechos
-- estructurados. Se regenera tras cada interacción (no por mensaje).
CREATE TABLE IF NOT EXISTS lead_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  ghl_contact_id text,
  profile_summary text,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_interaction_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_memory_tenant_phone_unique UNIQUE (tenant_id, phone_e164)
);

CREATE INDEX IF NOT EXISTS lead_memory_tenant_ghl_idx
  ON lead_memory (tenant_id, ghl_contact_id);
