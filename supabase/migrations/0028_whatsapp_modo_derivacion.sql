-- Modo del asistente de WhatsApp, por clínica.
--
-- Hasta aquí el asistente siempre cerraba el círculo: informaba Y reservaba la
-- cita. Hay centros que no lo quieren así — prefieren que recopile la consulta
-- y se la pase al profesional que corresponda, y que sea esa persona quien
-- decida y coordine. Para ellos existe el modo 'DERIVE'.
--
-- 'BOOKING' es el comportamiento de siempre y sigue siendo el defecto: esta
-- migración no cambia el asistente de ninguna clínica existente.
--
-- derive_fallback_phone es a quién se avisa cuando la consulta no encaja con
-- ningún profesional del catálogo (o el que encaja no tiene móvil cargado).
-- Sin él, una consulta así se queda sólo en la tarea y en el chat interno.

ALTER TABLE whatsapp_agent_settings
  ADD COLUMN IF NOT EXISTS agent_mode text NOT NULL DEFAULT 'BOOKING',
  ADD COLUMN IF NOT EXISTS derive_fallback_phone text;

DO $$
BEGIN
  ALTER TABLE whatsapp_agent_settings
    ADD CONSTRAINT whatsapp_agent_settings_agent_mode_check
    CHECK (agent_mode IN ('BOOKING', 'DERIVE'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN whatsapp_agent_settings.agent_mode IS
  'BOOKING = el asistente agenda. DERIVE = recopila la consulta y se la pasa por WhatsApp al profesional que corresponde.';
COMMENT ON COLUMN whatsapp_agent_settings.derive_fallback_phone IS
  'E.164. Destinatario de respaldo en modo DERIVE cuando ningún profesional encaja con la consulta.';
