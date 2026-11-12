-- Salud del canal de WhatsApp (12/11/2026).
--
-- Del 11/11 a las 18:15 al 12/11 a las 08:20 la sesión de Evolution de
-- Respinens recibía los mensajes con 2-4 h de retraso (sesión cifrada
-- corrupta en Baileys) y nadie se enteró: los "1" del recordatorio del día no
-- llegaron y a las 12:30 se anularon siete citas. Con estas columnas la app
-- sabe si el canal está vivo antes de hacer algo irreversible (anular una
-- cita, reservar un hueco para una oferta) y avisa al equipo en cuanto falla.
ALTER TABLE whatsapp_connections
  ADD COLUMN IF NOT EXISTS last_fresh_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_lagged_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_inbound_lag_seconds integer,
  ADD COLUMN IF NOT EXISTS health_alerted_at timestamptz;

COMMENT ON COLUMN whatsapp_connections.last_fresh_inbound_at IS
  'Último mensaje entrante que llegó a tiempo (escrito hace menos de 10 min). Prueba de que el canal recibe.';
COMMENT ON COLUMN whatsapp_connections.last_lagged_inbound_at IS
  'Último mensaje entrante que llegó con retraso (más de 10 min desde que se escribió). Canal no fiable durante 3 h.';
COMMENT ON COLUMN whatsapp_connections.health_alerted_at IS
  'Último aviso al equipo por un problema del canal (para no repetirlo).';
