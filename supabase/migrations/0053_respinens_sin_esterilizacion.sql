-- Respinens (fisioterapia respiratoria) no usa autoclave: la rutina dental
-- "Registro del ciclo de esterilización" se apaga (no se materializa más) y
-- sus tareas, la de hoy y las anteriores, se archivan. Sólo clínicas con
-- perfil de atención; las dentales la conservan.

UPDATE task_templates t
SET enabled = false,
    updated_at = now()
FROM tenant_care_profile cp
WHERE cp.tenant_id = t.tenant_id
  AND t.key = 'esterilizacion-ciclo'
  AND t.enabled = true;

UPDATE tasks k
SET archived_at = now(),
    updated_at = now()
FROM task_templates t, tenant_care_profile cp
WHERE t.id = k.template_id
  AND t.tenant_id = k.tenant_id
  AND cp.tenant_id = k.tenant_id
  AND t.key = 'esterilizacion-ciclo'
  AND k.archived_at IS NULL;
