-- Confirmación del día (Respinens, 10/11/2026): sin respuesta, el segundo
-- aviso de las 09:00 se repite por WhatsApp a las 10:00, 11:00 y 12:00 en vez
-- de pedirle al equipo que llame. `callVia = 'whatsapp'` hace que los pasos de
-- `callAt` manden el mismo texto del aviso a la familia.
UPDATE tenant_care_profile
SET message_scripts = jsonb_set(
      jsonb_set(message_scripts, '{dayOf,callAt}', '["10:00","11:00","12:00"]'::jsonb),
      '{dayOf,callVia}', '"whatsapp"'::jsonb
    ),
    updated_at = now()
WHERE message_scripts ? 'dayOf';
