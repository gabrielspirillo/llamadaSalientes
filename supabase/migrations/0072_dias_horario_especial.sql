-- Días con horario especial (13/11/2026, Respinens).
--
-- La clínica atiende de tarde, pero algunos días sueltos abre también por la
-- mañana (o sólo por la mañana). Un día especial SUSTITUYE el horario semanal
-- del profesional en esa fecha por las franjas que se indiquen aquí: "de 9:00
-- a 13:00" y, si esa tarde trabaja con normalidad, "de 15:00 a 20:00". Lo leen
-- el motor de huecos (panel y asistentes), el control de fuera de horario, el
-- calendario y el texto del horario que reciben los asistentes.
CREATE TABLE IF NOT EXISTS professional_special_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  -- Fecha local de la clínica.
  day date NOT NULL,
  -- [{"start": minuto, "end": minuto}], ordenadas y sin solaparse (1 a 3).
  ranges jsonb NOT NULL,
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT professional_special_days_ranges_array CHECK (jsonb_typeof(ranges) = 'array')
);

CREATE UNIQUE INDEX IF NOT EXISTS professional_special_days_uniq
  ON professional_special_days (tenant_id, professional_id, day);
CREATE INDEX IF NOT EXISTS professional_special_days_tenant_day_idx
  ON professional_special_days (tenant_id, day);
