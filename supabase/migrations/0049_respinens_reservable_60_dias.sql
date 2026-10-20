-- Respinens: "Reservable hasta" estaba en 7 días, y esa ventana se aplicaba
-- también al panel, así que recepción no podía dar ninguna cita más allá de
-- una semana (nada de noviembre a mediados de octubre). El panel ya no la
-- aplica (es una regla para los agentes); aquí se sube a dos meses, lo que
-- pidió la clínica, para que los asistentes también ofrezcan esas fechas.
--
-- Sólo clínicas con perfil de atención (hoy, Respinens) y sólo si estaba por
-- debajo: un valor mayor puesto a mano se respeta.

UPDATE professionals
SET max_advance_days = 60,
    updated_at = now()
WHERE max_advance_days < 60
  AND tenant_id IN (SELECT tenant_id FROM tenant_care_profile);
