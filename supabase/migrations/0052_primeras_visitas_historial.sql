-- Primera visita = paciente que empieza de cero. Una cita marcada como primera
-- cuando el paciente ya tenía historia (citas atendidas o notas clínicas
-- anteriores) se corrige. Y con perfil de atención (Respinens) dos primeras
-- visitas no van seguidas: el tope pasa de 2 a 1 (el agente sólo lo salta si
-- no queda ningún otro hueco).

UPDATE agenda_appointments a
SET is_first_visit = false,
    updated_at = now()
WHERE a.is_first_visit = true
  AND (
    EXISTS (
      SELECT 1 FROM agenda_appointments b
      WHERE b.tenant_id = a.tenant_id
        AND b.id <> a.id
        AND b.starts_at < a.starts_at
        AND b.status NOT IN ('CANCELLED', 'NO_SHOW')
        AND (
          (a.patient_id IS NOT NULL AND b.patient_id = a.patient_id)
          OR (a.patient_key IS NOT NULL AND a.patient_key NOT LIKE 'anon:%' AND b.patient_key = a.patient_key)
        )
    )
    OR EXISTS (
      SELECT 1 FROM clinical_notes n
      WHERE n.tenant_id = a.tenant_id
        AND n.created_at < a.starts_at
        AND (
          (a.patient_id IS NOT NULL AND n.patient_id = a.patient_id)
          OR (a.patient_key IS NOT NULL AND a.patient_key NOT LIKE 'anon:%' AND n.patient_key = a.patient_key)
        )
    )
  );

UPDATE tenant_care_profile
SET booking_policy = jsonb_set(booking_policy, '{maxConsecutiveFirstVisits}', '1'::jsonb),
    updated_at = now()
WHERE COALESCE((booking_policy->>'maxConsecutiveFirstVisits')::int, 2) > 1;
