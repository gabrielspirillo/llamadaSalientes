-- Respinens: el tratamiento "GEMELOS / MELLIZOS" no decía qué tipo de visita
-- es, así que la cita se marcaba "primera visita" por el historial (dos niños
-- nuevos) y salía con la etiqueta naranja en vez de G/M. La clínica lo dijo
-- claro: "no es ni primera visita ni nada, es un gemelo mellizo". Además,
-- contadas como primeras, dos mellizos seguidos agotaban la regla de "no más de
-- dos primeras visitas seguidas".
--
-- Sólo clínicas con perfil de atención y sólo tratamientos sin marcar.

UPDATE treatments t
SET visit_kind = 'FOLLOW_UP'
FROM tenant_care_profile cp
WHERE cp.tenant_id = t.tenant_id
  AND t.visit_kind IS NULL
  AND (
    translate(lower(t.name), 'áéíóú', 'aeiou') LIKE '%gemel%'
    OR translate(lower(t.name), 'áéíóú', 'aeiou') LIKE '%melliz%'
  );

UPDATE agenda_appointments a
SET is_first_visit = false,
    updated_at = now()
FROM treatments t
WHERE t.id = a.treatment_id
  AND t.tenant_id = a.tenant_id
  AND t.visit_kind = 'FOLLOW_UP'
  AND a.is_first_visit = true;
