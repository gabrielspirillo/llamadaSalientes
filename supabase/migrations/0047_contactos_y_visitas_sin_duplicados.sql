-- Contactos sin duplicar y una nota por visita.
--
-- 1) Teléfonos españoles guardados sin prefijo. El panel normalizaba
--    "600 11 22 33" como "+600112233"; cuando ese tutor escribía por WhatsApp
--    (+34600112233) nacía un segundo contacto, al lado del que tiene a sus
--    hijos con ficha e historia. El código ya normaliza a +34; aquí se corrige
--    lo guardado:
--      a) si existe el gemelo con +34, todo lo del sufijado pasa a él
--         (conversaciones, notas de contacto, pacientes) y el sufijado se borra;
--      b) si no, se le pone el +34 en el sitio.
--    Las claves `tel:` de citas, notas, cobros y facturas se reescriben igual.
--
-- 2) Notas clínicas repetidas de la misma visita. Guardar la nota del día y
--    volver a abrir la ficha para añadir algo creaba otra nota, y la historia
--    contaba dos visitas. Se juntan en la primera las del mismo paciente,
--    profesional, día (el de la cita, o el de creación si va suelta, en la
--    hora de la clínica) y privacidad (una valoración privada va aparte): cada campo une los textos distintos en orden, la
--    carita es la última que se puso, y el resto se borra.

-- ─── 1) Teléfonos ────────────────────────────────────────────────────────────

CREATE TEMP TABLE _phone_fix AS
SELECT
  bad.id AS bad_id,
  bad.tenant_id,
  bad.phone_e164 AS old_phone,
  '+34' || substr(bad.phone_e164, 2) AS new_phone,
  good.id AS good_id
FROM whatsapp_contacts bad
LEFT JOIN whatsapp_contacts good
  ON good.tenant_id = bad.tenant_id
 AND good.phone_e164 = '+34' || substr(bad.phone_e164, 2)
WHERE bad.phone_e164 ~ '^\+[6-9][0-9]{8}$';

UPDATE whatsapp_conversations c
SET contact_id = f.good_id, updated_at = now()
FROM _phone_fix f
WHERE f.good_id IS NOT NULL AND c.contact_id = f.bad_id;

UPDATE whatsapp_contact_notes n
SET contact_id = f.good_id
FROM _phone_fix f
WHERE f.good_id IS NOT NULL AND n.contact_id = f.bad_id;

UPDATE patients p
SET contact_id = f.good_id, updated_at = now()
FROM _phone_fix f
WHERE f.good_id IS NOT NULL AND p.contact_id = f.bad_id;

-- El gemelo hereda lo que le falte (nombre, correo, id del CRM).
UPDATE whatsapp_contacts good
SET
  name = coalesce(good.name, bad.name),
  first_name = coalesce(good.first_name, bad.first_name),
  last_name = coalesce(good.last_name, bad.last_name),
  email = coalesce(good.email, bad.email),
  ghl_contact_id = coalesce(good.ghl_contact_id, bad.ghl_contact_id),
  updated_at = now()
FROM _phone_fix f
JOIN whatsapp_contacts bad ON bad.id = f.bad_id
WHERE f.good_id = good.id;

DELETE FROM whatsapp_contacts c
USING _phone_fix f
WHERE f.good_id IS NOT NULL AND c.id = f.bad_id;

UPDATE whatsapp_contacts c
SET phone_e164 = f.new_phone, updated_at = now()
FROM _phone_fix f
WHERE f.good_id IS NULL AND c.id = f.bad_id;

UPDATE agenda_appointments
SET patient_phone = '+34' || substr(patient_phone, 2)
WHERE patient_phone ~ '^\+[6-9][0-9]{8}$';

UPDATE agenda_appointments
SET patient_key = 'tel:+34' || substr(patient_key, 6)
WHERE patient_key ~ '^tel:\+[6-9][0-9]{8}$';

UPDATE clinical_notes
SET patient_key = 'tel:+34' || substr(patient_key, 6)
WHERE patient_key ~ '^tel:\+[6-9][0-9]{8}$';

UPDATE patient_charges
SET patient_key = 'tel:+34' || substr(patient_key, 6)
WHERE patient_key ~ '^tel:\+[6-9][0-9]{8}$';

UPDATE invoices
SET patient_key = 'tel:+34' || substr(patient_key, 6)
WHERE patient_key ~ '^tel:\+[6-9][0-9]{8}$';

-- ─── 2) Una nota por visita ──────────────────────────────────────────────────

CREATE TEMP TABLE _note_visit AS
SELECT
  n.id,
  n.created_at,
  first_value(n.id) OVER w AS keep_id,
  count(*) OVER (PARTITION BY n.tenant_id, n.patient_key, n.professional_id, n.private,
    (coalesce(a.starts_at, n.created_at) AT TIME ZONE coalesce(cs.timezone, 'Europe/Madrid'))::date) AS n_in_visit
FROM clinical_notes n
LEFT JOIN agenda_appointments a ON a.id = n.appointment_id
LEFT JOIN clinic_settings cs ON cs.tenant_id = n.tenant_id
WINDOW w AS (
  PARTITION BY n.tenant_id, n.patient_key, n.professional_id, n.private,
    (coalesce(a.starts_at, n.created_at) AT TIME ZONE coalesce(cs.timezone, 'Europe/Madrid'))::date
  ORDER BY n.created_at, n.id
);

DELETE FROM _note_visit WHERE n_in_visit < 2;

-- Une los textos distintos y no vacíos de un campo, en el orden en que se
-- escribieron.
CREATE TEMP TABLE _note_merged AS
SELECT
  v.keep_id,
  (SELECT string_agg(t.val, E'\n\n' ORDER BY t.first_at) FROM (
     SELECT btrim(n2.summary) AS val, min(n2.created_at) AS first_at
     FROM _note_visit v2 JOIN clinical_notes n2 ON n2.id = v2.id
     WHERE v2.keep_id = v.keep_id AND btrim(coalesce(n2.summary, '')) <> ''
     GROUP BY btrim(n2.summary)) t) AS summary,
  (SELECT string_agg(t.val, E'\n\n' ORDER BY t.first_at) FROM (
     SELECT btrim(n2.treatment_performed) AS val, min(n2.created_at) AS first_at
     FROM _note_visit v2 JOIN clinical_notes n2 ON n2.id = v2.id
     WHERE v2.keep_id = v.keep_id AND btrim(coalesce(n2.treatment_performed, '')) <> ''
     GROUP BY btrim(n2.treatment_performed)) t) AS treatment_performed,
  (SELECT string_agg(t.val, E'\n\n' ORDER BY t.first_at) FROM (
     SELECT btrim(n2.observations) AS val, min(n2.created_at) AS first_at
     FROM _note_visit v2 JOIN clinical_notes n2 ON n2.id = v2.id
     WHERE v2.keep_id = v.keep_id AND btrim(coalesce(n2.observations, '')) <> ''
     GROUP BY btrim(n2.observations)) t) AS observations,
  (SELECT string_agg(t.val, E'\n\n' ORDER BY t.first_at) FROM (
     SELECT btrim(n2.next_steps) AS val, min(n2.created_at) AS first_at
     FROM _note_visit v2 JOIN clinical_notes n2 ON n2.id = v2.id
     WHERE v2.keep_id = v.keep_id AND btrim(coalesce(n2.next_steps, '')) <> ''
     GROUP BY btrim(n2.next_steps)) t) AS next_steps,
  (SELECT string_agg(t.val, E'\n\n' ORDER BY t.first_at) FROM (
     SELECT btrim(n2.symptoms) AS val, min(n2.created_at) AS first_at
     FROM _note_visit v2 JOIN clinical_notes n2 ON n2.id = v2.id
     WHERE v2.keep_id = v.keep_id AND btrim(coalesce(n2.symptoms, '')) <> ''
     GROUP BY btrim(n2.symptoms)) t) AS symptoms,
  (SELECT string_agg(t.val, E'\n\n' ORDER BY t.first_at) FROM (
     SELECT btrim(n2.examination) AS val, min(n2.created_at) AS first_at
     FROM _note_visit v2 JOIN clinical_notes n2 ON n2.id = v2.id
     WHERE v2.keep_id = v.keep_id AND btrim(coalesce(n2.examination, '')) <> ''
     GROUP BY btrim(n2.examination)) t) AS examination,
  (SELECT n2.session_behavior
     FROM _note_visit v2 JOIN clinical_notes n2 ON n2.id = v2.id
     WHERE v2.keep_id = v.keep_id AND n2.session_behavior IS NOT NULL
     ORDER BY n2.created_at DESC LIMIT 1) AS session_behavior,
  (SELECT n2.appointment_id
     FROM _note_visit v2 JOIN clinical_notes n2 ON n2.id = v2.id
     WHERE v2.keep_id = v.keep_id AND n2.appointment_id IS NOT NULL
     ORDER BY n2.created_at LIMIT 1) AS appointment_id,
  bool_and(n.private) AS private
FROM _note_visit v
JOIN clinical_notes n ON n.id = v.id
GROUP BY v.keep_id;

UPDATE clinical_notes n
SET
  summary = coalesce(m.summary, n.summary),
  treatment_performed = m.treatment_performed,
  observations = m.observations,
  next_steps = m.next_steps,
  symptoms = m.symptoms,
  examination = m.examination,
  session_behavior = coalesce(m.session_behavior, n.session_behavior),
  appointment_id = coalesce(n.appointment_id, m.appointment_id),
  private = m.private,
  updated_at = now()
FROM _note_merged m
WHERE n.id = m.keep_id;

DELETE FROM clinical_notes n
USING _note_visit v
WHERE n.id = v.id AND v.id <> v.keep_id;

DROP TABLE _note_merged;
DROP TABLE _note_visit;
DROP TABLE _phone_fix;
