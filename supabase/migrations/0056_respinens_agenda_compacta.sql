-- Respinens: el asistente no ofrece toda la disponibilidad del día. Si el
-- profesional ya tiene citas ese día, sólo huecos a como mucho 2 horas de la
-- primera o de la última (y primero los pegados a una cita), para que no
-- queden horas sueltas entre medias. Un día sin citas se ofrece entero.
UPDATE tenant_care_profile
SET booking_policy = booking_policy || '{"clusterAroundMinutes": 120}'::jsonb,
    updated_at = now()
WHERE message_scripts ? 'dayOf'
  AND NOT (booking_policy ? 'clusterAroundMinutes');
