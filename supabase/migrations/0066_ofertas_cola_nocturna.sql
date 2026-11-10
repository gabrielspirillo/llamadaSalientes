-- Huecos que se liberan de noche: no se ofrecen hasta las 08:00 (lo pidió la
-- clínica el 9/11: "si la gente está durmiendo no va a poder contestar y va a
-- recorrer toda la agenda sin que nadie conteste"). Se guardan aquí y el tick
-- de cada 5 minutos los ofrece por la mañana, si siguen libres.
CREATE TABLE IF NOT EXISTS advance_offer_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  slot_starts_at timestamptz NOT NULL,
  slot_ends_at timestamptz NOT NULL,
  freed_appointment_id uuid REFERENCES agenda_appointments(id) ON DELETE SET NULL,
  cancelled_slot_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS advance_offer_queue_pending_idx
  ON advance_offer_queue (tenant_id, created_at) WHERE processed_at IS NULL;

-- Un hueco, una vez en la cola.
CREATE UNIQUE INDEX IF NOT EXISTS advance_offer_queue_slot_uniq
  ON advance_offer_queue (tenant_id, professional_id, slot_starts_at) WHERE processed_at IS NULL;
