-- Finanzas: la recurrencia de un gasto puede ser mensual, trimestral o anual.
--
-- "Se repite cada mes" cubría el alquiler y la cuota, pero no el seguro que se
-- paga por trimestres ni el IBI, que es una vez al año. `recurrence` dice cada
-- cuánto; `is_recurring` se conserva como bandera rápida (true = tiene
-- recurrencia) para no tocar lo que ya la lee. Las filas marcadas antes de
-- esta migración pasan a MONTHLY, que es lo único que significaba la casilla.

ALTER TABLE finance_entries
  ADD COLUMN IF NOT EXISTS recurrence text
  CHECK (recurrence IS NULL OR recurrence IN ('MONTHLY', 'QUARTERLY', 'YEARLY'));

UPDATE finance_entries
SET recurrence = 'MONTHLY'
WHERE is_recurring AND recurrence IS NULL;

COMMENT ON COLUMN finance_entries.recurrence IS
  'Cada cuánto se repite (MONTHLY | QUARTERLY | YEARLY). NULL = no se repite.';
