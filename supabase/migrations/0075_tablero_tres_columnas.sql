-- Tablero de tres columnas (14/11/2026): Por hacer, En curso y Hecho.
-- «En revisión» deja de ofrecerse; las que hubiera pasan a En curso. El valor
-- sigue en el enum por compatibilidad (quitar un valor de un enum en Postgres
-- obliga a recrear el tipo y no aporta nada).
UPDATE tasks SET status = 'IN_PROGRESS', updated_at = now() WHERE status = 'IN_REVIEW';
