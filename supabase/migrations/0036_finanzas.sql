-- Módulo Finanzas: ingresos, gastos, comprobantes y salud del negocio.
--
-- Hasta aquí la plataforma sólo sabía de dinero POR PACIENTE (los cobros de
-- cada cita, migración 0034). Respinens pidió ver el negocio entero: lo que
-- entra contra lo que sale, con los tickets y las facturas guardados, y los
-- indicadores que dicen si la clínica va bien. Es un módulo contratable
-- (`tenants.enabled_modules.finance`), como WhatsApp o las llamadas.
--
-- Decisión de fondo: los cobros de las citas NO se duplican aquí. La ficha del
-- paciente sigue siendo la fuente de ese ingreso (`patient_charges`), y el
-- módulo los LEE junto con el libro propio (`finance_entries`): un libro
-- unificado sin dos copias que se separan al día siguiente.
--
-- Cuatro tablas y ninguna cambia nada para quien no use el módulo:
--   1. `finance_categories`: categorías de gasto e ingreso por clínica, con
--      la marca de FIJO (se paga haya o no pacientes: alquiler, autónomos) que
--      es lo que sostiene el punto de equilibrio. Se siembran unas por
--      defecto y la clínica las ajusta.
--   2. `finance_entries`: el libro. Un gasto o un ingreso que no viene de una
--      cita (alquiler, luz, venta de un producto). Dos fechas: `occurred_on`
--      (devengo: "la luz de marzo") y `paid_on` (caja: cuándo salió el dinero).
--   3. `finance_entry_files`: sus comprobantes, en el bucket interno; la URL
--      se firma en cada lectura.
--   4. `finance_settings`: el objetivo de ingresos mensual.

CREATE TABLE IF NOT EXISTS finance_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('INCOME', 'EXPENSE')),
  -- Clave estable para sembrar sin duplicar ("alquiler", "nominas").
  slug text NOT NULL,
  name text NOT NULL,
  -- Fijo = se paga igual haya o no pacientes. Es lo que separa el punto de
  -- equilibrio de un simple "gastos totales".
  is_fixed boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  -- Sembrada por la plataforma: se puede renombrar o archivar, no borrar.
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_categories_slug_uniq
  ON finance_categories (tenant_id, kind, slug);

COMMENT ON TABLE finance_categories IS
  'Categorías de gasto e ingreso de la clínica. is_fixed marca los costes fijos.';

CREATE TABLE IF NOT EXISTS finance_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('INCOME', 'EXPENSE')),
  category_id uuid REFERENCES finance_categories(id) ON DELETE SET NULL,
  concept text NOT NULL,
  -- Proveedor (gasto) o quien paga (ingreso). Texto libre.
  counterparty text,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  -- IVA incluido en el importe, si se quiere desglosar. 0 = sin desglose.
  tax_cents integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  currency text NOT NULL DEFAULT 'EUR',
  -- Devengo: el día del gasto o del ingreso.
  occurred_on date NOT NULL,
  status text NOT NULL DEFAULT 'PAID' CHECK (status IN ('PENDING', 'PAID')),
  -- Caja: el día que el dinero salió o entró. NULL mientras está pendiente.
  paid_on date,
  payment_method text CHECK (
    payment_method IS NULL
    OR payment_method IN ('CARD', 'CASH', 'BIZUM', 'TRANSFER', 'DIRECT_DEBIT')
  ),
  -- Para atribuir un ingreso o un gasto a un profesional concreto.
  professional_id uuid REFERENCES professionals(id) ON DELETE SET NULL,
  -- Se repite cada mes (alquiler, cuota, seguro): "traer los del mes pasado".
  is_recurring boolean NOT NULL DEFAULT false,
  -- 'rec:<entrada de origen>:<YYYY-MM>' al replicar un recurrente: un mes, una copia.
  dedupe_key text,
  notes text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finance_entries_occurred_idx
  ON finance_entries (tenant_id, occurred_on DESC);
CREATE INDEX IF NOT EXISTS finance_entries_paid_idx
  ON finance_entries (tenant_id, paid_on DESC)
  WHERE paid_on IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS finance_entries_dedupe_uniq
  ON finance_entries (tenant_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

COMMENT ON TABLE finance_entries IS
  'Libro de ingresos y gastos que no vienen de una cita. Los cobros de citas viven en patient_charges.';
COMMENT ON COLUMN finance_entries.occurred_on IS 'Devengo: el día del gasto o del ingreso.';
COMMENT ON COLUMN finance_entries.paid_on IS 'Caja: el día que el dinero se movió. NULL si está pendiente.';

CREATE TABLE IF NOT EXISTS finance_entry_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES finance_entries(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS finance_entry_files_entry_idx
  ON finance_entry_files (entry_id, created_at);

CREATE TABLE IF NOT EXISTS finance_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Objetivo de ingresos al mes. NULL = sin objetivo (no se dibuja la barra).
  monthly_revenue_goal_cents integer CHECK (
    monthly_revenue_goal_cents IS NULL OR monthly_revenue_goal_cents >= 0
  ),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- El módulo lee los cobros de las citas por fecha de pago: sin este índice cada
-- resumen recorría todos los cargos de la clínica.
CREATE INDEX IF NOT EXISTS patient_charges_paid_on_idx
  ON patient_charges (tenant_id, paid_on)
  WHERE paid_on IS NOT NULL;

-- ─── Encender el módulo a Respinens ──────────────────────────────────────────
--
-- Es quien lo pidió. Mismo criterio de búsqueda que el perfil de atención
-- (0031): por el slug de su organización en Clerk y, si no coincide, por "la
-- única clínica cuyo nombre empieza por Respinens". Idempotente: `||` pisa la
-- clave sin tocar el resto de módulos. Futura puede apagarlo o encenderlo a
-- otras clínicas desde Configuración → Módulos.

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
UPDATE tenants
SET enabled_modules = coalesce(enabled_modules, '{}'::jsonb) || '{"finance": true}'::jsonb
WHERE id IN (SELECT id FROM objetivo);
