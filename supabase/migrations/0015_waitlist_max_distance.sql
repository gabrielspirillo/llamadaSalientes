-- Ventana máxima de lejanía de cita para entrar a la waitlist.
-- NULL = sin límite (comportamiento anterior).
ALTER TABLE waitlist_settings
  ADD COLUMN IF NOT EXISTS max_appointment_distance_days integer;
