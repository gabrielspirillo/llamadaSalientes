-- "Si se libera un hueco hoy, que sea para este paciente": la clínica elige a
-- un niño (tenga o no cita) y va el primero cuando se libera un hueco en el
-- rango de días que diga. Si acepta, se le crea la cita y recibe los mensajes
-- de confirmación de siempre. Ver lib/agenda/advance-offers.ts.

CREATE TABLE IF NOT EXISTS slot_priority_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE,
  patient_key text NOT NULL,
  patient_name text NOT NULL,
  phone_e164 text NOT NULL,
  -- Null = cualquier profesional.
  professional_id uuid REFERENCES professionals(id) ON DELETE CASCADE,
  treatment_id uuid REFERENCES treatments(id) ON DELETE SET NULL,
  -- Días locales 'YYYY-MM-DD' en los que vale (ambos incluidos).
  from_day text NOT NULL,
  until_day text NOT NULL,
  note text,
  -- ACTIVE | BOOKED | CANCELLED
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS slot_priority_requests_active_idx
  ON slot_priority_requests (tenant_id, status, from_day, until_day);

-- Una oferta puede ir a una cita existente (adelantar) o a una petición de
-- prioridad (dar cita nueva).
ALTER TABLE advance_offers ALTER COLUMN appointment_id DROP NOT NULL;
ALTER TABLE advance_offers
  ADD COLUMN IF NOT EXISTS request_id uuid REFERENCES slot_priority_requests(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS advance_offers_one_pending_per_request
  ON advance_offers (tenant_id, request_id) WHERE status = 'SENT' AND request_id IS NOT NULL;
