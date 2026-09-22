-- El WhatsApp del profesional, aparte de su teléfono de contacto.
--
-- `professionals.phone` es texto libre y lleva de todo: fijos del centro,
-- extensiones, números apuntados como se leen. Para el modo DERIVE hace falta
-- otra cosa —un móvil con WhatsApp, en E.164— y hace falta poder exigirlo sin
-- invalidar lo que ya hay cargado. Por eso es una columna propia y no una
-- validación sobre la vieja.
--
-- Backfill: se copia el teléfono SÓLO cuando ya está en formato internacional.
-- Un "600 11 22 33" no se convierte: sin prefijo no se sabe de qué país es, y
-- adivinarlo es justo el error que esta columna viene a evitar.

ALTER TABLE professionals
  ADD COLUMN IF NOT EXISTS whatsapp_e164 text;

UPDATE professionals
SET whatsapp_e164 = regexp_replace(phone, '[^0-9+]', '', 'g')
WHERE whatsapp_e164 IS NULL
  AND phone IS NOT NULL
  AND regexp_replace(phone, '[^0-9+]', '', 'g') ~ '^\+[1-9][0-9]{7,14}$';

COMMENT ON COLUMN professionals.whatsapp_e164 IS
  'WhatsApp del profesional en E.164 (+34600112233). Es a donde el asistente le manda las consultas derivadas.';
