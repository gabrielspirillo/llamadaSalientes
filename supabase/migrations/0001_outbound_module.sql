-- Outbound calls module: separar agente inbound/outbound y agregar campañas.

-- 1. Permitir múltiples agent_configs por tenant (uno por role).
ALTER TABLE "agent_configs"
  ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'inbound';

ALTER TABLE "agent_configs"
  DROP CONSTRAINT IF EXISTS "agent_configs_tenant_id_unique";

ALTER TABLE "agent_configs"
  ADD CONSTRAINT "agent_configs_tenant_role_unique" UNIQUE ("tenant_id", "role");

-- 2. Tabla de campañas de llamadas salientes.
CREATE TABLE IF NOT EXISTS "outbound_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "use_case" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "from_phone_id" uuid REFERENCES "phone_numbers"("id"),
  "override_agent_id" text,
  "retell_batch_call_id" text,
  "scheduled_at" timestamp with time zone,
  "call_window_start" integer,
  "call_window_end" integer,
  "timezone" text,
  "max_retries" integer NOT NULL DEFAULT 0,
  "retry_delay_minutes" integer NOT NULL DEFAULT 60,
  "shared_dynamic_vars" jsonb DEFAULT '{}'::jsonb,
  "notes" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "dispatched_at" timestamp with time zone,
  "completed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "outbound_campaigns_tenant_idx"
  ON "outbound_campaigns" ("tenant_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "outbound_campaigns_status_idx"
  ON "outbound_campaigns" ("tenant_id", "status");

-- 3. Targets (destinatarios) por campaña.
CREATE TABLE IF NOT EXISTS "outbound_targets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL REFERENCES "outbound_campaigns"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "to_number" text NOT NULL,
  "patient_name" text,
  "email" text,
  "ghl_contact_id" text,
  "dynamic_vars" jsonb DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "retell_call_id" text,
  "last_disconnection_reason" text,
  "last_error" text,
  "next_retry_at" timestamp with time zone,
  "last_attempt_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "outbound_targets_campaign_idx"
  ON "outbound_targets" ("campaign_id", "status");
CREATE INDEX IF NOT EXISTS "outbound_targets_tenant_idx"
  ON "outbound_targets" ("tenant_id");
CREATE INDEX IF NOT EXISTS "outbound_targets_retell_call_idx"
  ON "outbound_targets" ("retell_call_id");
