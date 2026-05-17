-- ─────────────────────────────────────────────────────────────────────────────
-- Analytics extensions: pricing + slot-fill attribution.
--
-- 1. treatments.price_cents       Precio del tratamiento en centavos (evita
--                                 drift floating-point) para calcular el
--                                 revenue recuperado por slots optimizados.
-- 2. cancelled_slots              Citas canceladas en GHL: cola de
--                                 oportunidades pendientes de recuperación.
-- 3. scheduling_offers            Recuperaciones efectivas: una nueva cita
--                                 que llenó un cancelled_slot, atribuida al
--                                 canal (outbound / inbound / whatsapp).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Precio por tratamiento, en centavos (entero, sin floats).
ALTER TABLE "treatments"
  ADD COLUMN IF NOT EXISTS "price_cents" integer;

-- 2. Canal que originó el llenado del slot cancelado.
CREATE TYPE "scheduling_offer_source" AS ENUM ('outbound', 'inbound', 'whatsapp');

-- 3. Slots cancelados: registro de cada cita cancelada. recovered_at NULL
--    indica que el slot sigue pendiente de ser ocupado.
CREATE TABLE "cancelled_slots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "ghl_appointment_id" text NOT NULL,
  "calendar_id" text,
  "treatment_id" uuid REFERENCES "treatments"("id"),
  "ghl_contact_id" text,
  "start_time" timestamptz NOT NULL,
  "end_time" timestamptz,
  "cancelled_at" timestamptz NOT NULL DEFAULT now(),
  "recovered_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "cancelled_slots_tenant_appt_unique" UNIQUE ("tenant_id", "ghl_appointment_id")
);

CREATE INDEX "cancelled_slots_tenant_recovered_idx"
  ON "cancelled_slots" ("tenant_id", "recovered_at", "cancelled_at");

-- Índice parcial para la query más frecuente: slots aún pendientes.
CREATE INDEX "cancelled_slots_pending_idx"
  ON "cancelled_slots" ("tenant_id", "start_time")
  WHERE "recovered_at" IS NULL;

-- 4. Ofertas aceptadas (slots recuperados). Un row por nueva cita que llena
--    un cancelled_slot. Snapshot del revenue al momento de la atribución
--    para que el dashboard no fluctúe si el precio del tratamiento cambia.
CREATE TABLE "scheduling_offers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "cancelled_slot_id" uuid NOT NULL REFERENCES "cancelled_slots"("id") ON DELETE CASCADE,
  "source" "scheduling_offer_source" NOT NULL,
  "trigger_call_id" uuid REFERENCES "calls"("id") ON DELETE SET NULL,
  "trigger_whatsapp_conversation_id" uuid REFERENCES "whatsapp_conversations"("id") ON DELETE SET NULL,
  "trigger_campaign_id" uuid REFERENCES "outbound_campaigns"("id") ON DELETE SET NULL,
  "treatment_id" uuid REFERENCES "treatments"("id"),
  "ghl_appointment_id" text NOT NULL,
  "accepted_at" timestamptz NOT NULL DEFAULT now(),
  "estimated_revenue_cents" integer NOT NULL DEFAULT 0,
  "currency" text NOT NULL DEFAULT 'USD',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "scheduling_offers_tenant_appt_unique" UNIQUE ("tenant_id", "ghl_appointment_id")
);

CREATE INDEX "scheduling_offers_tenant_accepted_idx"
  ON "scheduling_offers" ("tenant_id", "accepted_at");
CREATE INDEX "scheduling_offers_tenant_source_idx"
  ON "scheduling_offers" ("tenant_id", "source");
CREATE INDEX "scheduling_offers_cancelled_slot_idx"
  ON "scheduling_offers" ("cancelled_slot_id");
