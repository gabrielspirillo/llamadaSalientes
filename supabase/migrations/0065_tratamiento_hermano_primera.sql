-- Respinens: "HERMANO PEQUEÑO - PRIMERA VISITA" no decía qué tipo de visita
-- es (visit_kind NULL), así que el asistente nunca la elegía: para un niño sin
-- historia sólo miraba los tratamientos marcados FIRST, que era únicamente la
-- "PRIMERA VISITA" a secas, y el hermano pequeño se reservaba (y se cobraba) a
-- precio de primera visita normal.
--
-- Sólo clínicas con perfil de atención y sólo tratamientos sin marcar.

UPDATE treatments t
SET visit_kind = 'FIRST'
FROM tenant_care_profile cp
WHERE cp.tenant_id = t.tenant_id
  AND t.visit_kind IS NULL
  AND translate(lower(t.name), 'áéíóú', 'aeiou') LIKE '%herman%'
  AND translate(lower(t.name), 'áéíóú', 'aeiou') LIKE '%primera%';
