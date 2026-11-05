-- "Si se libera un hueco de hoy, ofrecérselo a X": la clínica marca esa cita
-- como prioritaria y, dentro de su fase, va la primera.
ALTER TABLE agenda_appointments ADD COLUMN IF NOT EXISTS advance_priority boolean NOT NULL DEFAULT false;

-- Respinens pidió el 5/11 que las primeras visitas también se ofrezcan a las
-- 19:00 de lunes y miércoles (la familia no las veía y recepción las daba a
-- mano saltándose la regla). Se quita la franja vetada; el tope de primeras
-- seguidas sigue.
UPDATE tenant_care_profile
SET booking_policy = booking_policy - 'firstVisitBlackouts'
WHERE booking_policy ? 'firstVisitBlackouts';

-- Guion para "quería informarme sobre las terapias / precios": la clínica no
-- quiere la lista del catálogo, sino su web y ofrecer cita.
UPDATE tenant_care_profile cp
SET message_scripts = coalesce(cp.message_scripts, '{}'::jsonb) || jsonb_build_object(
  'infoRequest', $i$Si necesitas información sobre las sesiones tienes todo detallado en nuestra página web: www.respinens.es

Si quieres agendar una cita para tu peque, dime y buscamos un hueco 😊$i$
)
FROM tenants t
WHERE t.id = cp.tenant_id AND (t.slug ILIKE 'respinens%' OR t.name ILIKE 'respinens%');
