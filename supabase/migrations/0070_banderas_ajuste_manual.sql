-- Banderas rojas: la clínica puede quitarlas, no sólo añadirlas (11/11/2026).
--
-- Las banderas se cuentan de la agenda (faltas y cancelaciones de la familia)
-- y `prior_red_flags` sumaba las de antes de la plataforma. Raquel pidió poder
-- dejarlas a 0: el campo de la ficha pasa a ser el TOTAL, y lo que se guarda
-- aquí es el ajuste respecto a lo contado (negativo = se quitaron a mano). Una
-- falta nueva vuelve a sumar desde ahí.
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_prior_red_flags_range;
ALTER TABLE patients
  ADD CONSTRAINT patients_prior_red_flags_range CHECK (prior_red_flags BETWEEN -999 AND 99);

COMMENT ON COLUMN patients.prior_red_flags IS
  'Ajuste manual de banderas rojas sobre las contadas de agenda_appointments: positivo = anteriores a la plataforma, negativo = quitadas a mano. Total = max(0, contadas + ajuste).';
