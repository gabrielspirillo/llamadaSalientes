-- Tareas automáticas que sólo hacían ruido en clínicas con perfil de atención
-- (Respinens, 10/11/2026):
--
-- 1. Las de citas de un paciente-persona (`pat:<uuid>`) salían como
--    "Paciente sin identificar": se les pone el nombre de la ficha.
-- 2. "Perseguir presupuesto" salía del "próximo paso" de cada nota clínica,
--    que allí es clínico, no un presupuesto. El barrido ya no las crea; las
--    abiertas se archivan (no se borran).

UPDATE tasks t
SET patient_name = trim(p.first_name || ' ' || coalesce(p.last_name, '')),
    title = replace(t.title, 'Paciente sin identificar', trim(p.first_name || ' ' || coalesce(p.last_name, ''))),
    updated_at = now()
FROM patients p
WHERE t.tenant_id = p.tenant_id
  AND t.patient_ghl_contact_id = 'pat:' || p.id::text
  AND t.patient_name = 'Paciente sin identificar';

UPDATE tasks t
SET archived_at = now(), updated_at = now()
FROM tenant_care_profile cp
WHERE cp.tenant_id = t.tenant_id
  AND t.source = 'AUTOMATION'
  AND t.automation_trigger = 'PENDING_TREATMENT_UNSCHEDULED'
  AND t.status <> 'DONE'
  AND t.archived_at IS NULL;
