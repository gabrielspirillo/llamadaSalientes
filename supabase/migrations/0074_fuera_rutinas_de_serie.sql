-- Fuera las rutinas y automatizaciones de serie (14/11/2026).
--
-- Cada clínica empezaba con 16 rutinas de clínica dental y 10 reglas de
-- automatización ENCENDIDAS sin haberlas pedido. Nadie las usaba (en Respinens
-- se cerraron 3 tareas de 364 en 30 días) y llenaban Tareas de cientos de
-- tarjetas. Desde ahora cada clínica crea las suyas, a medida, desde
-- Tareas → Rutinas. Ya no se siembra nada.
--
-- Las tareas abiertas que crearon se ARCHIVAN (no se borran). En producción
-- no había ni una rutina ni una regla creada por una clínica: todo era de
-- serie, así que se archivan todas las abiertas de origen rutina o automática.
UPDATE tasks
   SET archived_at = now(), updated_at = now()
 WHERE archived_at IS NULL
   AND status <> 'DONE'
   AND (
     (source = 'ROUTINE' AND (template_id IS NULL OR template_id IN (SELECT id FROM task_templates WHERE is_system)))
     OR (source = 'AUTOMATION' AND NOT EXISTS (
       SELECT 1 FROM task_automation_rules r
        WHERE r.tenant_id = tasks.tenant_id AND NOT r.is_system
     ))
   );

-- Sus pasos (task_template_items) se van con ellas (ON DELETE CASCADE); las
-- tareas ya creadas conservan su historia con template_id a NULL.
DELETE FROM task_templates WHERE is_system;
DELETE FROM task_automation_rules WHERE is_system;
