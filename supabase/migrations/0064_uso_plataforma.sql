-- Uso de la plataforma por clínica: minutos activos por usuario, día y
-- sección. Lo llena el latido del panel (POST /api/usage/beat, uno por minuto
-- con la pestaña visible y la persona activa). Lo lee el panel de Futura
-- (/dashboard/futura/uso). Futura entrando a una clínica no cuenta.

CREATE TABLE IF NOT EXISTS usage_minutes (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Día local de la clínica, 'YYYY-MM-DD'.
  day date NOT NULL,
  section text NOT NULL,
  minutes integer NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, day, section)
);
CREATE INDEX IF NOT EXISTS usage_minutes_day_idx ON usage_minutes (day, tenant_id);
