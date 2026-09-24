-- Borra TODAS las tareas de una clínica. Pensado para limpiar los tableros de
-- las organizaciones de prueba, cuyas tareas (rutinas sembradas por la
-- auto-provisión y automatizaciones de llamadas/WhatsApp de prueba) no dicen
-- nada a nadie.
--
-- Las tablas hijas (task_assignees, task_checklist_items, task_comments)
-- cuelgan de tasks.id con ON DELETE CASCADE, así que se van solas.
-- Las plantillas de rutina y las reglas de automatización NO se tocan: son la
-- configuración de la clínica, no su historial. Si la clínica vuelve a entrar
-- en /dashboard/tasks, el cron materializa las rutinas del día otra vez.
--
-- Cómo correrlo en el VPS (72.60.212.232):
--   docker exec -i $(docker ps -qf name=cliniq-postgres) \
--     psql -U cliniq -d cliniq -v slug="'juanfran-s-organization-1788202447676614548'" \
--     < scripts/maintenance/purge-tasks-tenant.sql
--
-- O pegándolo en la consola SQL de Dokploy, reemplazando :slug por el literal.

BEGIN;

-- Ver a quién le vamos a borrar antes de borrar.
SELECT t.id AS tenant_id, t.slug, t.name, count(ta.id) AS tareas
FROM tenants t
LEFT JOIN tasks ta ON ta.tenant_id = t.id
WHERE t.slug = :slug
GROUP BY t.id, t.slug, t.name;

DELETE FROM tasks
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = :slug);

-- Revisar el recuento de arriba antes de confirmar.
COMMIT;
