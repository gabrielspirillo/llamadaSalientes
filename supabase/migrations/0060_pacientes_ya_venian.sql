-- Fichas importadas de los contactos de la clínica: ya eran pacientes.
--
-- El 25/09 Respinens importó ~2.300 fichas desde los contactos de su móvil.
-- Sus visitas son de antes de la plataforma, así que aquí no tienen ninguna
-- cita y el sistema los trataba como PRIMERA VISITA. Con esta marca, una ficha importada nunca es primera
-- visita. Las importaciones nuevas la ponen solas.

ALTER TABLE patients ADD COLUMN IF NOT EXISTS came_before boolean NOT NULL DEFAULT false;

-- Las fichas creadas en la importación masiva (todas las de ese día de cada
-- clínica con más de 50 altas en un mismo día).
UPDATE patients p
SET came_before = true
FROM (
  SELECT tenant_id, created_at::date AS dia
  FROM patients
  GROUP BY tenant_id, created_at::date
  HAVING count(*) > 50
) bulk
WHERE p.tenant_id = bulk.tenant_id
  AND p.created_at::date = bulk.dia
  AND p.came_before = false;
