-- ─────────────────────────────────────────────────────────────────────────────
-- Recordatorios de citas: scheduler multi-canal (WhatsApp / voz Retell) con
-- reglas globales por tenant y override opcional por tratamiento.
--
-- Tablas:
--   reminder_rule_sets       — 1 GLOBAL por tenant + N por tratamiento.
--   reminder_rules           — N reglas por set (offset + canal primario/fallback).
--   reminder_message_templates — 1 template por (regla, driverScope).
--   appointment_reminders    — instancia materializada (1 por cita+regla).
--   reminder_confirmations   — respuestas (botón, voz, manual).
--   reminder_skip_log        — citas no recordables (sin teléfono, fuera de horario, etc.).
--
-- Idempotencia: unique (tenant_id, ghl_appointment_id, rule_id) en
-- appointment_reminders permite re-materializar sin duplicar al recibir
-- AppointmentUpdate.
--
-- Notas:
--   - El webhook GHL ahora popula appointments_cache antes de materializar.
--   - No usamos FK compuesta a appointments_cache para que el reminder no se
--     rompa si la cache se vacía / rebuilds. ghl_appointment_id es text.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE reminder_channel AS ENUM ('WHATSAPP', 'VOICE');
CREATE TYPE reminder_rule_scope AS ENUM ('GLOBAL', 'TREATMENT');
CREATE TYPE reminder_status AS ENUM (
  'SCHEDULED',
  'SENT',
  'DELIVERED',
  'CONFIRMED',
  'RESCHEDULE_REQUESTED',
  'CANCELLED',
  'NO_RESPONSE',
  'SKIPPED',
  'FAILED'
);
CREATE TYPE reminder_skip_reason AS ENUM (
  'no_phone',
  'past_due',
  'no_rules',
  'no_whatsapp',
  'no_voice_agent',
  'no_template',
  'quiet_hours_full_day',
  'opt_out',
  'appointment_cancelled',
  'duplicate'
);
CREATE TYPE reminder_confirmation_action AS ENUM ('confirm', 'reschedule', 'cancel');
CREATE TYPE reminder_confirmation_source AS ENUM ('button', 'voice', 'manual', 'inbound_text');
CREATE TYPE reminder_quiet_mode AS ENUM ('SHIFT_INTO_HOURS', 'SKIP');

-- ─── reminder_rule_sets ──────────────────────────────────────────────────────
CREATE TABLE reminder_rule_sets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope        reminder_rule_scope NOT NULL,
  treatment_id uuid REFERENCES treatments(id) ON DELETE CASCADE,
  enabled      boolean NOT NULL DEFAULT true,
  quiet_mode   reminder_quiet_mode NOT NULL DEFAULT 'SHIFT_INTO_HOURS',
  updated_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reminder_rule_sets_treatment_scope_chk
    CHECK ((scope = 'GLOBAL' AND treatment_id IS NULL) OR
           (scope = 'TREATMENT' AND treatment_id IS NOT NULL))
);

CREATE UNIQUE INDEX reminder_rule_sets_global_unique
  ON reminder_rule_sets (tenant_id)
  WHERE scope = 'GLOBAL';

CREATE UNIQUE INDEX reminder_rule_sets_treatment_unique
  ON reminder_rule_sets (tenant_id, treatment_id)
  WHERE scope = 'TREATMENT';

CREATE INDEX reminder_rule_sets_tenant_enabled_idx
  ON reminder_rule_sets (tenant_id, enabled);

-- ─── reminder_rules ──────────────────────────────────────────────────────────
CREATE TABLE reminder_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_set_id           uuid NOT NULL REFERENCES reminder_rule_sets(id) ON DELETE CASCADE,
  offset_minutes        integer NOT NULL CHECK (offset_minutes > 0),
  primary_channel       reminder_channel NOT NULL,
  fallback_channel      reminder_channel,
  fallback_window_hours integer CHECK (fallback_window_hours BETWEEN 1 AND 72),
  label                 text,
  "order"               integer NOT NULL DEFAULT 0,
  enabled               boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reminder_rules_fallback_chk
    CHECK ((fallback_channel IS NULL AND fallback_window_hours IS NULL) OR
           (fallback_channel IS NOT NULL AND fallback_window_hours IS NOT NULL
            AND fallback_channel <> primary_channel))
);

CREATE INDEX reminder_rules_set_order_idx ON reminder_rules (rule_set_id, "order");
CREATE INDEX reminder_rules_tenant_enabled_idx ON reminder_rules (tenant_id, enabled);

-- ─── reminder_message_templates ──────────────────────────────────────────────
CREATE TABLE reminder_message_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_id               uuid NOT NULL REFERENCES reminder_rules(id) ON DELETE CASCADE,
  channel               reminder_channel NOT NULL,
  -- whatsapp_cloud | whatsapp_twilio | whatsapp_evolution | voice_retell
  driver_scope          text NOT NULL,
  -- Para Cloud/Twilio: nombre de la plantilla aprobada en WABA.
  template_name         text,
  template_language     text NOT NULL DEFAULT 'es',
  -- Mapeo posicional de params: [{ source: 'contact.first_name' }, ...].
  template_params_map   jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Sólo Evolution: cuerpo libre con {{variables}}.
  free_text             text,
  -- Override de botones interactivos. Default = 3 botones (confirm/reschedule/cancel).
  buttons               jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Sólo voz: prompt extra para el agente Retell, llena dynamicVar.
  voice_prompt_override text,
  enabled               boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reminder_message_templates_rule_driver_unique
    UNIQUE (rule_id, driver_scope)
);

CREATE INDEX reminder_message_templates_tenant_channel_idx
  ON reminder_message_templates (tenant_id, channel);

-- ─── appointment_reminders ───────────────────────────────────────────────────
CREATE TABLE appointment_reminders (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ghl_appointment_id     text NOT NULL,
  rule_id                uuid NOT NULL REFERENCES reminder_rules(id) ON DELETE RESTRICT,
  rule_set_id            uuid NOT NULL REFERENCES reminder_rule_sets(id) ON DELETE RESTRICT,
  scheduled_for          timestamptz NOT NULL,
  channel_planned        reminder_channel NOT NULL,
  channel_used           reminder_channel,
  status                 reminder_status NOT NULL DEFAULT 'SCHEDULED',
  sent_at                timestamptz,
  delivered_at           timestamptz,
  responded_at           timestamptz,
  bull_job_id            text,
  bull_fallback_job_id   text,
  external_call_id       text,
  external_message_id    uuid,
  failure_reason         text,
  payload_snapshot       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_reminders_tenant_appt_rule_unique
    UNIQUE (tenant_id, ghl_appointment_id, rule_id)
);

CREATE INDEX appointment_reminders_tenant_status_sched_idx
  ON appointment_reminders (tenant_id, status, scheduled_for);
CREATE INDEX appointment_reminders_tenant_appt_idx
  ON appointment_reminders (tenant_id, ghl_appointment_id);
CREATE INDEX appointment_reminders_external_call_idx
  ON appointment_reminders (external_call_id)
  WHERE external_call_id IS NOT NULL;

-- ─── reminder_confirmations ──────────────────────────────────────────────────
CREATE TABLE reminder_confirmations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reminder_id    uuid NOT NULL REFERENCES appointment_reminders(id) ON DELETE CASCADE,
  action         reminder_confirmation_action NOT NULL,
  source         reminder_confirmation_source NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  actor_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX reminder_confirmations_tenant_reminder_idx
  ON reminder_confirmations (tenant_id, reminder_id);

-- ─── reminder_skip_log ───────────────────────────────────────────────────────
CREATE TABLE reminder_skip_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ghl_appointment_id text NOT NULL,
  rule_id            uuid REFERENCES reminder_rules(id) ON DELETE SET NULL,
  reason             reminder_skip_reason NOT NULL,
  details            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reminder_skip_log_tenant_created_idx
  ON reminder_skip_log (tenant_id, created_at DESC);

-- ─── Extensiones de tablas existentes ────────────────────────────────────────

-- Contexto libre para handoff (ej: { remindersResume: { reminderId, action, expiresAt } }).
-- El agente WA lo lee para arrancar reagendado proactivamente.
ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Mensaje que la clínica responde cuando un contacto pide opt-out.
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS opt_out_message text;
