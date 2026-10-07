-- La primera visita la decide el tratamiento, no sólo el historial.
--
-- Hasta aquí `is_first_visit` se calculaba al crear la cita mirando si el
-- paciente tenía alguna cita previa en la plataforma. Los pacientes que una
-- clínica trae de antes no tienen ninguna, así que contaban todos como nuevos:
-- tres "VISITA RECURRENTE" seguidas disparaban la regla de no encadenar más de
-- dos primeras, y el motor de huecos vaciaba la tarde.
--
-- `treatments.visit_kind`:
--   FIRST     → la cita es primera visita.
--   FOLLOW_UP → no lo es.
--   NULL      → se decide por el historial, como siempre.
--
-- Idempotente: sólo marca tratamientos sin marca y sólo corrige citas que
-- siguen en verdadero.

ALTER TABLE treatments
  ADD COLUMN IF NOT EXISTS visit_kind text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'treatments_visit_kind_check'
  ) THEN
    ALTER TABLE treatments
      ADD CONSTRAINT treatments_visit_kind_check
      CHECK (visit_kind IS NULL OR visit_kind IN ('FIRST', 'FOLLOW_UP'));
  END IF;
END $$;

COMMENT ON COLUMN treatments.visit_kind IS
  'FIRST | FOLLOW_UP | NULL. Si está, decide is_first_visit de la cita; NULL = por historial.';

-- Marcado por nombre, sólo en clínicas con perfil de atención (hoy, Respinens:
-- "PRIMERA VISITA…" y "VISITA RECURRENTE…"). Sin tildes ni mayúsculas.
UPDATE treatments t
SET visit_kind = 'FIRST'
FROM tenant_care_profile cp
WHERE cp.tenant_id = t.tenant_id
  AND t.visit_kind IS NULL
  AND translate(lower(t.name), 'áéíóú', 'aeiou') LIKE '%primera visita%';

UPDATE treatments t
SET visit_kind = 'FOLLOW_UP'
FROM tenant_care_profile cp
WHERE cp.tenant_id = t.tenant_id
  AND t.visit_kind IS NULL
  AND translate(lower(t.name), 'áéíóú', 'aeiou') LIKE '%recurrente%';

-- Las citas de seguimiento ya creadas dejan de contar como primera visita.
UPDATE agenda_appointments a
SET is_first_visit = false,
    updated_at = now()
FROM treatments t
WHERE t.id = a.treatment_id
  AND t.tenant_id = a.tenant_id
  AND t.visit_kind = 'FOLLOW_UP'
  AND a.is_first_visit = true;
