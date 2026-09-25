-- Índices de rendimiento — segunda tanda.
--
-- Continúa 0023_performance_indexes.sql, que cubrió lo que existía entonces.
-- Estos son los huecos que dejaron los módulos posteriores (Finanzas, la ficha
-- del paciente v3) más un orden de recordatorios que nunca tuvo índice.
--
-- Se usa CREATE INDEX (no CONCURRENTLY) por el mismo motivo que en 0023: el
-- runner de lib/db/migrate.ts envuelve cada archivo en una transacción y
-- CONCURRENTLY no puede correr dentro de un bloque transaccional. `audit_logs`
-- y `patient_charges` ya tienen volumen real en producción: si el lock de
-- escritura molesta, crearlos a mano con CONCURRENTLY por psql ANTES de
-- desplegar — el IF NOT EXISTS hace que esta migración pase de largo.

-- ─── audit_logs: pestaña "Actividad" de la ficha del paciente ────────────────
-- lib/patients/activity.ts filtra por `after->>'patientKey'` (la vía principal:
-- toda acción sobre un paciente deja ahí su clave) y, en segundo lugar, por
-- (entity, entity_id) para 'patient' y 'patient_charge'. El único índice de la
-- tabla es (tenant_id, created_at), que no cubre ninguna de las dos.
--
-- audit_logs registra CADA mutación de la app —tratamientos, faqs, membresías,
-- telefonía, profesionales, citas, notas, consentimientos, cobros, facturas—
-- así que crece sin techo: sin estos índices, abrir esa pestaña en cualquier
-- paciente recorría el historial completo de la clínica.
--
-- El índice NO es parcial a propósito. Un `WHERE after ? 'patientKey'` haría
-- el índice más pequeño, pero el planificador no puede deducir esa condición
-- del predicado real de la consulta (`after->>'patientKey' = $1`), así que
-- descartaría el índice y volveríamos al punto de partida. Las filas sin esa
-- clave se indexan como NULL y no estorban.
CREATE INDEX IF NOT EXISTS audit_logs_tenant_patient_key_idx
  ON audit_logs (tenant_id, (after ->> 'patientKey'), created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_tenant_entity_idx
  ON audit_logs (tenant_id, entity, entity_id, created_at DESC);

-- ─── patient_charges: libro de Finanzas ──────────────────────────────────────
-- lib/finance/queries.ts (loadCharges) ordena por created_at DESC sobre TODOS
-- los pacientes de la clínica. Los índices que hay no sirven para eso:
-- patient_charges_patient_idx lleva patient_key en medio, que rompe el orden
-- global, y patient_charges_paid_on_idx es parcial sobre otra columna. Sin
-- este, cada carga de Finanzas hacía seq-scan + sort de todos los cobros.
CREATE INDEX IF NOT EXISTS patient_charges_tenant_created_idx
  ON patient_charges (tenant_id, created_at DESC);

-- ─── appointment_reminders: listado /dashboard/reminders ─────────────────────
-- La página ordena por scheduled_for DESC SIN filtrar por estado, y el índice
-- que existe —(tenant_id, status, scheduled_for)— no da orden global cruzando
-- estados: Postgres caía a un sort completo del historial de recordatorios.
CREATE INDEX IF NOT EXISTS appointment_reminders_tenant_scheduled_idx
  ON appointment_reminders (tenant_id, scheduled_for DESC);
