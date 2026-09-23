-- Cobros por cita y comprobantes: la pestaña "Contable" de la ficha del
-- paciente.
--
-- Hasta aquí la plataforma no sabía nada de dinero por paciente: la clínica
-- llevaba aparte quién pagó qué. La ficha rediseñada (Respinens) trae una
-- pestaña con lo facturado, lo cobrado y lo pendiente, y por cada cita el
-- pago (importe, método, fecha) y sus comprobantes (factura, ticket del TPV,
-- justificante del Bizum).
--
-- Dos tablas y ninguna cambia nada para quien no las use:
--   1. `patient_charges`: un cargo por cita (o suelto). Nace PENDING cuando se
--      adjunta un comprobante antes de cobrar, y pasa a PAID al registrar el
--      pago. `amount_cents` es NULL mientras nadie fijó el importe: "sin
--      importe" y "0 €" no son lo mismo.
--   2. `patient_charge_files`: los comprobantes, en el bucket interno (no el
--      público de WhatsApp: una factura lleva nombre y DNI del tutor). La URL
--      se firma en cada lectura, nunca se guarda.
--
-- La identidad del paciente es la misma `patient_key` de la agenda (`pat:`,
-- `tel:`, `ghl:`), así que funciona para las clínicas con y sin perfil.

CREATE TABLE IF NOT EXISTS patient_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_key text NOT NULL,
  -- El paciente como persona, cuando la clínica los lleva así.
  patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
  -- SET NULL y no CASCADE: si la cita desaparece, el cobro y su factura
  -- siguen existiendo.
  appointment_id uuid REFERENCES agenda_appointments(id) ON DELETE SET NULL,
  -- "Fisioterapia respiratoria · Dra. Ruiz". Se copia al crear el cargo para
  -- que el histórico no cambie si después se renombra el tratamiento.
  concept text NOT NULL,
  -- NULL = importe sin fijar todavía.
  amount_cents integer CHECK (amount_cents IS NULL OR amount_cents >= 0),
  currency text NOT NULL DEFAULT 'EUR',
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID')),
  payment_method text CHECK (
    payment_method IS NULL OR payment_method IN ('CARD', 'CASH', 'BIZUM', 'TRANSFER')
  ),
  -- Fecha de pago como fecha de calendario: "pagó el 14 de marzo", no un instante.
  paid_on date,
  paid_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patient_charges_patient_idx
  ON patient_charges (tenant_id, patient_key, created_at DESC);
-- Un cargo por cita: registrar el pago dos veces actualiza el mismo, no crea
-- otro.
CREATE UNIQUE INDEX IF NOT EXISTS patient_charges_appointment_uniq
  ON patient_charges (tenant_id, appointment_id)
  WHERE appointment_id IS NOT NULL;

COMMENT ON TABLE patient_charges IS
  'Cobro por cita (o suelto) de un paciente. PENDING hasta que se registra el pago.';
COMMENT ON COLUMN patient_charges.amount_cents IS
  'NULL mientras nadie fijó el importe (se adjuntó un comprobante antes de cobrar).';

CREATE TABLE IF NOT EXISTS patient_charge_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  charge_id uuid NOT NULL REFERENCES patient_charges(id) ON DELETE CASCADE,
  -- INVOICE = factura, RECEIPT = ticket/comprobante, PROOF = justificante de pago.
  kind text NOT NULL DEFAULT 'RECEIPT' CHECK (kind IN ('INVOICE', 'RECEIPT', 'PROOF')),
  file_name text NOT NULL,
  -- Key en el bucket interno (S3_BUCKET_INTERNAL).
  storage_key text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes >= 0),
  uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patient_charge_files_charge_idx
  ON patient_charge_files (charge_id, created_at);

-- ─── "A tener en cuenta" en la cabecera de la ficha ──────────────────────────
--
-- La cabecera rediseñada resume en una línea lo que hay que tener presente al
-- atender al niño (prematuro, ingresos, alergias…). Qué ítems de la anamnesis
-- cuentan para eso lo decide la propia plantilla con `alert: true`; aquí se
-- marcan los de la plantilla pediátrica. Los que no lo lleven (hermanos,
-- guardería, mascotas) siguen en la anamnesis, pero no en la cabecera.
-- Idempotente: volver a correrlo deja el mismo resultado.

UPDATE tenant_care_profile
SET
  anamnesis_template = (
    SELECT jsonb_agg(
      CASE
        WHEN item->>'key' IN (
          'enfermedad_importante', 'prematuro', 'ingresos', 'alergias', 'pa', 'rge', 'antecedentes'
        )
        THEN item || '{"alert": true}'::jsonb
        ELSE item
      END
      ORDER BY ord
    )
    FROM jsonb_array_elements(anamnesis_template) WITH ORDINALITY AS t(item, ord)
  ),
  updated_at = now()
WHERE profile = 'PEDIATRIC'
  AND jsonb_typeof(anamnesis_template) = 'array'
  AND jsonb_array_length(anamnesis_template) > 0;
