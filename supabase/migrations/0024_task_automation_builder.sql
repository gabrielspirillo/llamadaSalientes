-- Automatizaciones a medida.
--
-- Hasta aquí cada clínica tenía exactamente las 10 reglas del catálogo, una por
-- evento, y solo podía activarlas o afinarlas. Este cambio abre el módulo: se
-- pueden crear reglas propias sobre los mismos eventos del producto, con
-- condiciones que deciden cuándo disparan y su propia lista de comprobación.

alter table task_automation_rules add column if not exists name text;
alter table task_automation_rules add column if not exists is_system boolean not null default false;
alter table task_automation_rules add column if not exists conditions jsonb not null default '[]'::jsonb;
alter table task_automation_rules add column if not exists checklist text[] not null default '{}';

-- Todo lo que ya existe es el catálogo sembrado: son reglas de sistema.
update task_automation_rules set is_system = true where is_system = false;

-- Se acabó "una regla por evento": ahora puede haber varias a medida.
alter table task_automation_rules
  drop constraint if exists task_automation_rules_tenant_id_trigger_key;

-- ...pero sigue habiendo como mucho UNA regla de sistema por evento (la del
-- catálogo). Es la que se siembra de forma idempotente y la que leen los
-- barridos diarios para sacar sus parámetros (p. ej. los meses de inactividad).
create unique index if not exists task_automation_rules_system_unique
  on task_automation_rules (tenant_id, trigger)
  where is_system;

-- El motor lee todas las reglas activas de un evento en cada disparo.
create index if not exists task_automation_rules_tenant_trigger_enabled_idx
  on task_automation_rules (tenant_id, trigger)
  where enabled;
