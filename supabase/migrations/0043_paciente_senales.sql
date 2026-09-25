-- Señales de conducta del paciente (pedido de Respinens, 2026-09-25).
--
-- La clínica las llevaba con emojis en el nombre de cada contacto de Google:
-- una carita pensativa para las familias que dudan (preguntan, no cogen cita,
-- y al tiempo la cogen) y una bandera roja por cada vez que cancelaron o no
-- vinieron. Aquí pasan a ser datos:
--
--   1. `patients.hesitant` (+ nota): la duda es una marca a mano, no se puede
--      deducir de la agenda.
--   2. Las banderas rojas SE CUENTAN de la agenda (citas NO_SHOW y CANCELLED),
--      no se guardan: un contador escrito a mano se desincroniza el primer día.
--      `patients.prior_red_flags` sólo existe para traer las banderas de antes
--      de la plataforma (las que ya están en sus contactos).
--   3. `agenda_appointments.cancelled_by`: una cita que anula la clínica (la
--      fisio está enferma) no es una bandera de la familia. NULL = no se sabe
--      (citas anteriores a esta migración) y cuenta como de la familia, que es
--      como las contaba la clínica.
--
-- Sólo se PINTAN en clínicas con perfil de atención; las columnas están para
-- todas, vacías, igual que el resto de `patients`.

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS hesitant boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hesitant_note text,
  ADD COLUMN IF NOT EXISTS prior_red_flags smallint NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patients_prior_red_flags_range'
  ) THEN
    ALTER TABLE patients
      ADD CONSTRAINT patients_prior_red_flags_range
      CHECK (prior_red_flags BETWEEN 0 AND 99);
  END IF;
END $$;

COMMENT ON COLUMN patients.hesitant IS
  'Familia que duda: pregunta, no coge cita y al tiempo la coge. Marca a mano.';
COMMENT ON COLUMN patients.prior_red_flags IS
  'Faltas y cancelaciones de antes de la plataforma. Las nuevas se cuentan de agenda_appointments.';

ALTER TABLE agenda_appointments
  ADD COLUMN IF NOT EXISTS cancelled_by text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agenda_appointments_cancelled_by_check'
  ) THEN
    ALTER TABLE agenda_appointments
      ADD CONSTRAINT agenda_appointments_cancelled_by_check
      CHECK (cancelled_by IS NULL OR cancelled_by IN ('PATIENT', 'CLINIC'));
  END IF;
END $$;

COMMENT ON COLUMN agenda_appointments.cancelled_by IS
  'Quién anuló la cita: PATIENT (cuenta como bandera roja) o CLINIC (no cuenta). NULL = sin dato, cuenta como PATIENT.';
