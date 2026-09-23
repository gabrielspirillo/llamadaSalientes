-- Correcciones de la ficha del paciente (revisión del 2026-09-23).
--
--   1. La anamnesis lleva quién la contestó y cuándo: en una historia clínica
--      "quién dijo esto" no es un detalle.
--   2. La plantilla pediátrica gana lo que la pestaña rediseñada necesita y
--      que antes no existía: agrupación (Antecedentes médicos · Perinatal ·
--      Entorno), el nombre completo de las siglas (RGE, VRS, CAP), un texto
--      guía para cada "¿cuál?", y dos marcas de lógica: `exclusive` (un "sí"
--      en "Sano" no cuadra con un "sí" en un ítem de alerta) y `noDetail`
--      (a "Sano: sí" no se le pregunta cuál). Se fusiona por clave, así que
--      un ajuste hecho a mano en el label o en `alert` se conserva.
--
-- Nada de esto cambia el comportamiento de una clínica sin perfil.

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS anamnesis_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS anamnesis_updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN patients.anamnesis_updated_at IS
  'Última vez que alguien guardó la anamnesis. Auditoría clínica.';

UPDATE tenant_care_profile
SET
  anamnesis_template = (
    SELECT jsonb_agg(item || COALESCE(extra.v, '{}'::jsonb) ORDER BY ord)
    FROM jsonb_array_elements(tenant_care_profile.anamnesis_template) WITH ORDINALITY AS t(item, ord)
    LEFT JOIN (
      VALUES
        ('sano', '{"group":"Antecedentes médicos","exclusive":true,"noDetail":true}'::jsonb),
        ('enfermedad_importante', '{"group":"Antecedentes médicos","hint":"Cuál y desde cuándo (ej.: asma, 2025)"}'::jsonb),
        ('prematuro', '{"group":"Perinatal","hint":"Semanas de gestación (ej.: 34)"}'::jsonb),
        ('ingresos', '{"group":"Antecedentes médicos","hint":"Cuántos, motivo y fecha (ej.: 1, bronquiolitis, dic. 2025)"}'::jsonb),
        ('vacuna_vrs', '{"group":"Perinatal","fullName":"Vacuna frente al virus respiratorio sincitial","hint":"Cuál y cuándo (ej.: nirsevimab, oct. 2025)"}'::jsonb),
        ('alergias', '{"group":"Antecedentes médicos","hint":"A qué (ej.: proteína de leche de vaca)"}'::jsonb),
        ('pa', '{"group":"Antecedentes médicos","hint":"Detalle"}'::jsonb),
        ('rge', '{"group":"Antecedentes médicos","fullName":"Reflujo gastroesofágico","hint":"Tratamiento, si lo tiene"}'::jsonb),
        ('antecedentes', '{"group":"Antecedentes médicos","fullName":"Antecedentes familiares","hint":"Quién y qué (ej.: madre con asma)"}'::jsonb),
        ('hermanos', '{"group":"Entorno","hint":"Cuántos y edades"}'::jsonb),
        ('fumadores', '{"group":"Entorno","hint":"Quién y dónde (en casa, fuera)"}'::jsonb),
        ('guarderia', '{"group":"Entorno","hint":"Desde cuándo"}'::jsonb),
        ('cap', '{"group":"Entorno","fullName":"Centro de atención primaria","hint":"Cuál y pediatra"}'::jsonb)
    ) AS extra(k, v) ON extra.k = item->>'key'
  ),
  updated_at = now()
WHERE profile = 'PEDIATRIC'
  AND jsonb_typeof(anamnesis_template) = 'array'
  AND jsonb_array_length(anamnesis_template) > 0;
