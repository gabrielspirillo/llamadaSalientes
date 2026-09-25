-- Facturas desde la ficha del paciente.
--
-- Respinens factura cada sesión (o un bono de varias) al tutor del niño y
-- quiere hacerlo desde la propia ficha, con los datos ya puestos, y bajarse
-- el PDF para mandarlo por correo o por WhatsApp. Hasta aquí la ficha sólo
-- registraba el cobro (`patient_charges`); la factura se hacía fuera.
--
-- Tres cosas:
--   1. `invoice_settings`: los datos del emisor (nombre, colegiada, NIF,
--      dirección, IBAN, logo, IVA, pie) y el contador de la serie por año.
--      Una fila por clínica; sin fila, se factura con el nombre de la clínica
--      y el resto en blanco.
--   2. `invoices`: la factura emitida, INMUTABLE. Guarda una foto del emisor
--      y del destinatario tal como estaban al emitirla (`issuer`, `bill_to_*`):
--      cambiar los datos de la clínica después no reescribe facturas viejas.
--      No se borran: se ANULAN (`status = 'VOID'`) y el número queda.
--   3. `patient_charges.invoice_id`: qué cobro va en qué factura, para que la
--      ficha lo enseñe y para no facturar dos veces la misma sesión.

CREATE TABLE IF NOT EXISTS invoice_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Quien emite: la profesional, no la marca. "Raquel Pinto Egea".
  issuer_name text,
  -- "Fisioterapeuta · Colegiada nº 10.751"
  issuer_subtitle text,
  tax_id text,
  -- Varias líneas separadas por salto de línea.
  address text,
  email text,
  phone text,
  -- Sólo se imprime cuando la forma de pago es transferencia.
  iban text,
  logo_url text,
  -- Lema bajo el logo: "Fisioterapia respiratoria pediátrica".
  tagline text,
  footer_left text,
  footer_center text,
  footer_right text,
  -- Sanidad va exenta (art. 20 Ley 37/1992): 0 y la nota. Otra clínica puede poner 21.
  vat_rate numeric(5, 2) NOT NULL DEFAULT 0,
  vat_note text,
  -- Concepto por defecto de una sesión, si la clínica quiere uno fijo.
  default_concept text,
  -- Serie por año: 2026-0000032. `next_number` es el siguiente a emitir.
  series_year integer,
  next_number integer NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number text NOT NULL,
  issued_on date NOT NULL,
  status text NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'VOID')),
  patient_key text NOT NULL,
  patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
  patient_name text NOT NULL,
  -- A quién se factura: el tutor. Foto al emitir.
  bill_to_name text NOT NULL,
  bill_to_tax_id text,
  bill_to_address text,
  bill_to_email text,
  bill_to_phone text,
  -- [{ concept, quantity, unitCents, appointmentIds }]
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
  vat_rate numeric(5, 2) NOT NULL DEFAULT 0,
  vat_cents integer NOT NULL DEFAULT 0 CHECK (vat_cents >= 0),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  -- CARD | CASH | BIZUM | TRANSFER (los mismos que patient_charges).
  payment_method text,
  notes text,
  -- Foto del emisor al emitir (nombre, NIF, dirección, IBAN, logo, pie…).
  issuer jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Key del PDF en el bucket interno. NULL si no se pudo generar; se reintenta al bajarlo.
  pdf_key text,
  whatsapp_message_id text,
  whatsapp_sent_at timestamptz,
  void_reason text,
  voided_at timestamptz,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_number_uniq ON invoices (tenant_id, number);
CREATE INDEX IF NOT EXISTS invoices_patient_idx ON invoices (tenant_id, patient_key, issued_on DESC);

COMMENT ON TABLE invoices IS
  'Factura emitida desde la ficha del paciente. Inmutable: se anula (VOID), no se borra.';

ALTER TABLE patient_charges
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS patient_charges_invoice_idx
  ON patient_charges (invoice_id)
  WHERE invoice_id IS NOT NULL;

-- ─── Datos de facturación de Respinens ───────────────────────────────────────
--
-- Son los de su plantilla de factura (datos públicos de la profesional que
-- ya van impresos en cada factura que emite). Mismo criterio de búsqueda que
-- el perfil (0031). Idempotente: si ya hay fila, no se toca.

WITH por_slug AS (
  SELECT id FROM tenants WHERE slug = 'respinens-logo-1789808641416119420'
),
por_nombre AS (
  SELECT id FROM tenants WHERE lower(name) LIKE 'respinens%'
),
objetivo AS (
  SELECT id FROM por_slug
  UNION ALL
  SELECT id FROM por_nombre
  WHERE NOT EXISTS (SELECT 1 FROM por_slug)
    AND (SELECT count(*) FROM por_nombre) = 1
)
INSERT INTO invoice_settings (
  tenant_id, issuer_name, issuer_subtitle, tax_id, address, email, phone, logo_url, tagline,
  footer_left, footer_center, footer_right, vat_rate, vat_note, default_concept, series_year, next_number
)
SELECT
  id,
  'Raquel Pinto Egea',
  'Fisioterapeuta · Colegiada nº 10.751',
  '05442362X',
  E'Av. de Carmen Martín Gaite, 17\n28919 Leganés, Madrid',
  'respinens@gmail.com',
  '676 790 181',
  'https://respinens.es/wp-content/uploads/2019/09/cropped-logo_respinens-2.png',
  'Fisioterapia respiratoria pediátrica',
  'Respinens · Fisioterapia respiratoria pediátrica',
  'Centro autorizado CS17385',
  'www.respinens.es',
  0,
  'Operación exenta por el art. 20 de la Ley 37/1992 del IVA',
  'Sesión de fisioterapia respiratoria pediátrica',
  extract(year FROM now())::int,
  1
FROM objetivo
ON CONFLICT (tenant_id) DO NOTHING;
