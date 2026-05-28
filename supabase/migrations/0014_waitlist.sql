-- ─────────────────────────────────────────────────────────────────────────────
-- Waitlist: cola FIFO de pacientes con cita futura elegibles para adelantar.
--
-- Flujo:
--   1. AppointmentCreate en GHL → autoEnqueueOnNewAppointment hace insert en
--      waitlist_entries si el tratamiento es elegible y la cita cumple los
--      umbrales de tenant.
--   2. AppointmentDelete/Cancel en GHL → recordCancelledSlot + dispara
--      enqueueOfferForCancelledSlot → busca el siguiente en cola y crea
--      una waitlist_offer (encolada en BullMQ).
--   3. El paciente responde aceptar/rechazar (WA buttons / Voice tool).
--      Acepta → markOfferAccepted: cita nueva via book_appointment en GHL,
--      cancela cita vieja → cascada (el delete vuelve a entrar al webhook
--      y dispara la siguiente oferta del nuevo cancelled_slot).
--   4. TTL expirado → expireOfferAndAdvance pasa al siguiente en cola.
--
-- Idempotencia:
--   - waitlist_entries.unique(tenant_id, ghl_appointment_id) — una entrada por cita.
--   - waitlist_offers no tiene unique sobre (entry, slot) intencionalmente:
--     un mismo paciente puede recibir múltiples ofertas históricas si rechaza
--     y vuelve a ser elegible más adelante. Se evita doble oferta activa con
--     un WHERE en findNextEligibleEntry (status PENDING/SENT bloquea).
--
-- Notas:
--   - waitlist_settings tiene PK = tenant_id (una fila por tenant). Se lazy-crea
--     con defaults sensatos al primer GET de settings.
--   - waitlist_message_templates es paralela a reminder_message_templates con
--     misma forma (driver_scope text). El resolver se reusa vía lib/messaging.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Toggle por tratamiento ──────────────────────────────────────────────────
ALTER TABLE treatments
  ADD COLUMN IF NOT EXISTS waitlist_eligible boolean NOT NULL DEFAULT false;

-- ─── Enums ───────────────────────────────────────────────────────────────────
CREATE TYPE waitlist_status AS ENUM ('ACTIVE', 'PAUSED', 'FULFILLED', 'REMOVED');
CREATE TYPE waitlist_offer_status AS ENUM (
  'PENDING',
  'SENT',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'SUPERSEDED'
);
CREATE TYPE waitlist_offer_channel AS ENUM ('WHATSAPP', 'VOICE');
CREATE TYPE waitlist_channel_mode AS ENUM (
  'WHATSAPP_ONLY',
  'VOICE_ONLY',
  'WHATSAPP_THEN_VOICE'
);
CREATE TYPE waitlist_entry_source AS ENUM ('auto', 'manual');
CREATE TYPE waitlist_offer_response_via AS ENUM ('button', 'text', 'voice_tool', 'manual');

-- ─── waitlist_settings ───────────────────────────────────────────────────────
CREATE TABLE waitlist_settings (
  tenant_id                       uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled                         boolean NOT NULL DEFAULT true,
  channel_mode                    waitlist_channel_mode NOT NULL DEFAULT 'WHATSAPP_ONLY',
  -- TTL por oferta (cuánto esperamos respuesta antes de pasar al siguiente).
  ttl_minutes_default             integer NOT NULL DEFAULT 240 CHECK (ttl_minutes_default > 0),
  ttl_minutes_near_slot           integer NOT NULL DEFAULT 60 CHECK (ttl_minutes_near_slot > 0),
  near_slot_hours_threshold       integer NOT NULL DEFAULT 12 CHECK (near_slot_hours_threshold > 0),
  min_skip_hours_threshold        integer NOT NULL DEFAULT 2 CHECK (min_skip_hours_threshold >= 0),
  -- Para fallback WHATSAPP_THEN_VOICE: cuánto esperar el WA antes de intentar voz.
  whatsapp_to_voice_window_minutes integer NOT NULL DEFAULT 60 CHECK (whatsapp_to_voice_window_minutes > 0),
  -- Umbrales para que una cita sea candidata.
  min_appointment_distance_days   integer NOT NULL DEFAULT 7 CHECK (min_appointment_distance_days >= 0),
  min_advance_days                integer NOT NULL DEFAULT 1 CHECK (min_advance_days >= 0),
  -- Filtros opcionales.
  require_same_dentist            boolean NOT NULL DEFAULT false,
  respect_time_window             boolean NOT NULL DEFAULT false,
  updated_by                      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

-- ─── waitlist_entries ────────────────────────────────────────────────────────
CREATE TABLE waitlist_entries (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ghl_contact_id                  text NOT NULL,
  ghl_appointment_id              text NOT NULL,
  treatment_id                    uuid REFERENCES treatments(id) ON DELETE SET NULL,
  calendar_id                     text,
  assigned_dentist_id             text,
  original_start_time             timestamptz NOT NULL,
  original_end_time               timestamptz,
  -- Ventana horaria preferida (HH:MM..HH:MM). NULL = sin restricción.
  preferred_time_window_start     text,
  preferred_time_window_end       text,
  status                          waitlist_status NOT NULL DEFAULT 'ACTIVE',
  source                          waitlist_entry_source NOT NULL DEFAULT 'auto',
  notes                           text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  fulfilled_at                    timestamptz,
  removed_at                      timestamptz,
  CONSTRAINT waitlist_entries_tenant_appt_unique
    UNIQUE (tenant_id, ghl_appointment_id)
);

-- Query principal del matcher: por (tenant, treatment) entre activos, ordenando
-- por created_at (FIFO).
CREATE INDEX waitlist_entries_match_idx
  ON waitlist_entries (tenant_id, treatment_id, created_at)
  WHERE status = 'ACTIVE';

CREATE INDEX waitlist_entries_tenant_status_idx
  ON waitlist_entries (tenant_id, status, created_at DESC);

CREATE INDEX waitlist_entries_contact_idx
  ON waitlist_entries (tenant_id, ghl_contact_id);

-- ─── waitlist_offers ─────────────────────────────────────────────────────────
CREATE TABLE waitlist_offers (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  waitlist_entry_id               uuid NOT NULL REFERENCES waitlist_entries(id) ON DELETE CASCADE,
  cancelled_slot_id               uuid NOT NULL REFERENCES cancelled_slots(id) ON DELETE CASCADE,
  channel                         waitlist_offer_channel NOT NULL,
  -- whatsapp_cloud | whatsapp_twilio | whatsapp_evolution | voice_retell
  driver_scope                    text NOT NULL,
  status                          waitlist_offer_status NOT NULL DEFAULT 'PENDING',
  sent_at                         timestamptz,
  expires_at                      timestamptz NOT NULL,
  responded_at                    timestamptz,
  response_via                    waitlist_offer_response_via,
  external_message_id             uuid,
  external_call_id                text,
  bull_send_job_id                text,
  bull_expire_job_id              text,
  payload_snapshot                jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message                   text,
  -- Cuando WHATSAPP_THEN_VOICE crea segunda oferta tras expirar la primera,
  -- previous_offer_id apunta a la original. Permite reportar "intento 2 de 2".
  previous_offer_id               uuid REFERENCES waitlist_offers(id) ON DELETE SET NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX waitlist_offers_tenant_status_idx
  ON waitlist_offers (tenant_id, status, expires_at);
CREATE INDEX waitlist_offers_cancelled_slot_idx
  ON waitlist_offers (cancelled_slot_id, status);
CREATE INDEX waitlist_offers_entry_idx
  ON waitlist_offers (waitlist_entry_id, created_at DESC);
CREATE INDEX waitlist_offers_tenant_accepted_idx
  ON waitlist_offers (tenant_id, responded_at)
  WHERE status = 'ACCEPTED';

-- Bloqueo de doble oferta activa para la misma entry. Index parcial.
CREATE UNIQUE INDEX waitlist_offers_entry_active_unique
  ON waitlist_offers (waitlist_entry_id)
  WHERE status IN ('PENDING', 'SENT');

-- ─── waitlist_message_templates ──────────────────────────────────────────────
-- Paralela a reminder_message_templates. Estructura idéntica para que el
-- resolver de templates (lib/messaging/template-resolver.ts) sirva ambos.
CREATE TABLE waitlist_message_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel               waitlist_offer_channel NOT NULL,
  -- whatsapp_cloud | whatsapp_twilio | whatsapp_evolution | voice_retell
  driver_scope          text NOT NULL,
  template_name         text,
  template_language     text NOT NULL DEFAULT 'es',
  template_params_map   jsonb NOT NULL DEFAULT '[]'::jsonb,
  free_text             text,
  buttons               jsonb NOT NULL DEFAULT '[]'::jsonb,
  voice_prompt_override text,
  enabled               boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waitlist_message_templates_tenant_driver_unique
    UNIQUE (tenant_id, driver_scope)
);

CREATE INDEX waitlist_message_templates_tenant_channel_idx
  ON waitlist_message_templates (tenant_id, channel);
