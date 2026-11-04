-- Ofertas de adelanto: cuando se libera un hueco, se le ofrece primero a las
-- familias que marcaron "quiere adelantar" (advance_preference = ACCEPTS) con
-- el mismo profesional y cita posterior. El hueco queda reservado con un
-- bloqueo mientras la familia contesta; si dice que no o no contesta, pasa a
-- la siguiente y, al acabar, a la lista de espera de siempre.

CREATE TABLE IF NOT EXISTS advance_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES agenda_appointments(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  -- La cita cancelada que dejó el hueco (null si el hueco lo dejó otra oferta).
  freed_appointment_id uuid REFERENCES agenda_appointments(id) ON DELETE SET NULL,
  cancelled_slot_id uuid REFERENCES cancelled_slots(id) ON DELETE SET NULL,
  slot_starts_at timestamptz NOT NULL,
  slot_ends_at timestamptz NOT NULL,
  hold_block_id uuid REFERENCES professional_time_off(id) ON DELETE SET NULL,
  phone_e164 text NOT NULL,
  status text NOT NULL DEFAULT 'SENT',
  sent_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS advance_offers_one_pending_per_appt
  ON advance_offers (tenant_id, appointment_id) WHERE status = 'SENT';
CREATE INDEX IF NOT EXISTS advance_offers_pending_idx
  ON advance_offers (tenant_id, status, expires_at);
CREATE INDEX IF NOT EXISTS advance_offers_slot_idx
  ON advance_offers (tenant_id, professional_id, slot_starts_at);
