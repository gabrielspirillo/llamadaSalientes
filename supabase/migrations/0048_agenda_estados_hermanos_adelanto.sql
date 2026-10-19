-- Ajustes de Respinens del 19/10.
--
-- 1) El nombre de la ficha manda: las citas y las notas guardan una copia del
--    nombre de cuando se crearon, y corregirlo en la ficha no se veía en la
--    agenda. `updatePatient` ya lo mantiene al día; esto pone al día lo viejo.
-- 2) Hermanos y gemelos: la etiqueta "H" / "G/M" se calcula (mismo contacto o
--    teléfono de tutor; gemelo = misma fecha de nacimiento), y `sibling_mark`
--    la fuerza a mano cuando el cálculo no llega (falta la fecha, etc.).
-- 3) Adelantar la cita: preferencia POR CITA (el mismo papá una semana quiere
--    adelantar y otra no) y la nota de horario ("puede a las 18h").
-- 4) Estados que se usan: una clínica que trabaja sola en recepción no marca
--    "En sala", "En gabinete" ni "Atendida". Se ocultan, no se borran.
-- 5) Teléfonos de tutores: se guardaban tal cual se escribían ("646 55 66 19");
--    se normalizan a E.164 con +34 para los móviles españoles sin prefijo.

-- 1)
UPDATE agenda_appointments a
SET patient_name = btrim(p.first_name || ' ' || coalesce(p.last_name, ''))
FROM patients p
WHERE a.patient_id = p.id
  AND a.tenant_id = p.tenant_id
  AND a.patient_name IS DISTINCT FROM btrim(p.first_name || ' ' || coalesce(p.last_name, ''));

UPDATE clinical_notes n
SET patient_name = btrim(p.first_name || ' ' || coalesce(p.last_name, ''))
FROM patients p
WHERE n.patient_id = p.id
  AND n.tenant_id = p.tenant_id
  AND n.patient_name IS DISTINCT FROM btrim(p.first_name || ' ' || coalesce(p.last_name, ''));

-- 2)
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS sibling_mark text
  CHECK (sibling_mark IN ('TWIN', 'SIBLING', 'NONE'));

-- 3)
ALTER TABLE agenda_appointments
  ADD COLUMN IF NOT EXISTS advance_preference text
  CHECK (advance_preference IN ('ACCEPTS', 'NO_MOVE'));
ALTER TABLE agenda_appointments
  ADD COLUMN IF NOT EXISTS advance_note text;
CREATE INDEX IF NOT EXISTS agenda_appointments_advance_idx
  ON agenda_appointments (tenant_id, starts_at)
  WHERE advance_preference = 'ACCEPTS';

-- 4)
UPDATE tenant_care_profile
SET booking_policy = booking_policy || '{"visibleStatuses": ["SCHEDULED", "CONFIRMED", "NO_SHOW"]}'::jsonb,
    updated_at = now()
WHERE profile = 'PEDIATRIC'
  AND jsonb_typeof(booking_policy) = 'object'
  AND NOT booking_policy ? 'visibleStatuses';

-- 5)
WITH fixed AS (
  SELECT
    p.id,
    jsonb_agg(
      CASE
        WHEN jsonb_typeof(g.item) = 'object' AND coalesce(g.item->>'phone', '') <> '' THEN
          jsonb_set(g.item, '{phone}', to_jsonb(
            CASE
              WHEN g.clean ~ '^[6-9][0-9]{8}$' THEN '+34' || g.clean
              WHEN g.clean ~ '^\+[6-9][0-9]{8}$' THEN '+34' || substr(g.clean, 2)
              WHEN g.clean ~ '^00[0-9]{7,15}$' THEN '+' || substr(g.clean, 3)
              WHEN g.clean ~ '^\+[0-9]{7,15}$' THEN g.clean
              WHEN g.clean ~ '^[0-9]{7,15}$' THEN '+' || g.clean
              ELSE g.item->>'phone'
            END))
        ELSE g.item
      END
      ORDER BY g.ord
    ) AS guardians
  FROM patients p,
    LATERAL (
      SELECT e.item, e.ord, regexp_replace(coalesce(e.item->>'phone', ''), '[^0-9+]', '', 'g') AS clean
      FROM jsonb_array_elements(p.guardians) WITH ORDINALITY AS e(item, ord)
    ) g
  WHERE jsonb_typeof(p.guardians) = 'array' AND jsonb_array_length(p.guardians) > 0
  GROUP BY p.id
)
UPDATE patients p
SET guardians = f.guardians
FROM fixed f
WHERE p.id = f.id AND p.guardians IS DISTINCT FROM f.guardians;
