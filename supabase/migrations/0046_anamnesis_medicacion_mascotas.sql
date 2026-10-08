-- Anamnesis pediátrica: Medicación y Mascotas.
--
-- Respinens pidió dos preguntas que faltaban en la anamnesis: si el niño toma
-- medicación (Antecedentes médicos, detrás de Alergias) y si hay mascotas en
-- casa (Entorno, detrás de Fumadores). Se insertan por clave en esa posición y
-- sólo si la plantilla todavía no las tiene, así que es idempotente y no pisa
-- ajustes hechos a mano. Si el ítem de referencia no existe, va al final.

UPDATE tenant_care_profile
SET
  anamnesis_template = (
    SELECT jsonb_agg(x.item ORDER BY x.ord, x.sub)
    FROM (
      SELECT t.item, t.ord, 0 AS sub
      FROM jsonb_array_elements(tenant_care_profile.anamnesis_template) WITH ORDINALITY AS t(item, ord)
      UNION ALL
      SELECT
        n.item,
        COALESCE(
          (
            SELECT r.ord
            FROM jsonb_array_elements(tenant_care_profile.anamnesis_template) WITH ORDINALITY AS r(item, ord)
            WHERE r.item->>'key' = n.after
          ),
          1000
        ),
        n.sub
      FROM (
        VALUES
          ('alergias', 1, '{"key":"medicacion","label":"Medicación","group":"Antecedentes médicos","hint":"Cuál y dosis (ej.: salbutamol inhalado)"}'::jsonb),
          ('fumadores', 1, '{"key":"mascotas","label":"Mascotas","group":"Entorno","hint":"Cuáles (ej.: perro, gato)"}'::jsonb)
      ) AS n(after, sub, item)
      WHERE NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(tenant_care_profile.anamnesis_template) AS e(item)
        WHERE e.item->>'key' = n.item->>'key'
      )
    ) AS x
  ),
  updated_at = now()
WHERE profile = 'PEDIATRIC'
  AND jsonb_typeof(anamnesis_template) = 'array'
  AND jsonb_array_length(anamnesis_template) > 0;
