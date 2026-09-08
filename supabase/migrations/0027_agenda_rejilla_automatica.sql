-- La rejilla de huecos pasa a ser opcional.
--
-- `slot_granularity_minutes` decía cada cuántos minutos puede EMPEZAR una cita,
-- que no es lo mismo que cuánto dura —eso lo pone el tratamiento— y era un
-- número que en la práctica nadie sabía responder. Lo normal es que las citas
-- vayan una detrás de otra: con una limpieza de 30 y una ortodoncia de 45, el
-- día se ordena solo (9:00, 9:45, 10:30…).
--
-- Ahora NULL significa "automático": el paso es la duración de la cita que se
-- está buscando. Un valor explícito (15, 20, 30…) sigue sirviendo para lo único
-- que aportaba: encajar citas cortas en los ratos que dejan las largas.
--
-- El defecto pasa a NULL. Las filas existentes con el antiguo 15 por defecto se
-- pasan a automático; cualquier otro valor era una decisión deliberada de la
-- clínica y se respeta.

ALTER TABLE professionals ALTER COLUMN slot_granularity_minutes DROP NOT NULL;
ALTER TABLE professionals ALTER COLUMN slot_granularity_minutes DROP DEFAULT;

UPDATE professionals SET slot_granularity_minutes = NULL WHERE slot_granularity_minutes = 15;

COMMENT ON COLUMN professionals.slot_granularity_minutes IS
  'Minutos entre inicios de cita. NULL = automático: el paso es la duración de la cita.';
