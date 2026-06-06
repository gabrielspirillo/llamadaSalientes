-- Personalización aditiva del agente de WhatsApp por tenant.
-- persona = instrucciones extra de tono/estilo/foco; agent_name = nombre con
-- que se presenta. NO anula las reglas duras ni los guardrails (eso es global).
CREATE TABLE IF NOT EXISTS whatsapp_agent_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  persona text,
  agent_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
