-- ─────────────────────────────────────────────────────────────────────────────
-- Módulo Tareas (core, sin gate de enabled_modules).
--
-- Por qué existe: en una clínica dental la operativa vive hoy en un grupo de
-- WhatsApp, post-its y un Excel. Lo que se pierde ahí es plata directa
-- (no-shows sin reagendar, presupuestos aceptados sin cita, recalls vencidos)
-- y cumplimiento legal (esterilización, RGPD, revisiones de rayos).
--
-- Tres orígenes de tarea (columna `source`):
--   MANUAL     — la crea una persona desde el tablero.
--   ROUTINE    — la materializa el worker desde una plantilla recurrente
--                (apertura, cierre, control biológico del autoclave, RAT...).
--   AUTOMATION — la crea una regla a partir de un evento que YA emite la app
--                (llamada perdida, cita cancelada, recordatorio sin respuesta,
--                oferta de waitlist aceptada sin agendar...).
--
-- Idempotencia: `dedupe_key` con índice único parcial por tenant. Las rutinas
-- usan `routine:<templateId>:<YYYY-MM-DD>` y las automatizaciones
-- `auto:<trigger>:<entidad>`. Así el worker puede reintentar sin duplicar.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Seguimiento postoperatorio por tratamiento ──────────────────────────────
-- Llamar a las 24 h después de una extracción o una cirugía cambia la
-- percepción del paciente; hacerlo después de una limpieza es ruido. El flag
-- lo decide la clínica tratamiento por tratamiento.
ALTER TABLE treatments
  ADD COLUMN IF NOT EXISTS post_op_follow_up boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS post_op_follow_up_hours integer NOT NULL DEFAULT 24;

-- ─── Enums ───────────────────────────────────────────────────────────────────
CREATE TYPE task_status AS ENUM ('TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE');
CREATE TYPE task_priority AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE task_category AS ENUM (
  'PATIENT',     -- seguimiento de paciente: reagendar, presupuesto, postop, recall
  'CLINICAL',    -- gabinete: esterilización, instrumental, equipos
  'ADMIN',       -- caja, agenda, stock, proveedores
  'COMPLIANCE',  -- RGPD/LOPDGDD, protección radiológica, validaciones legales
  'TEAM',        -- turnos, formación, reuniones
  'MARKETING'    -- reseñas, campañas, reactivación
);
CREATE TYPE task_source AS ENUM ('MANUAL', 'ROUTINE', 'AUTOMATION');
CREATE TYPE task_recurrence_freq AS ENUM (
  'DAILY',
  'WEEKDAYS',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'YEARLY'
);
CREATE TYPE task_automation_trigger AS ENUM (
  'MISSED_CALL',                    -- llamada entrante no resuelta por el agente
  'CALL_INTENT_UNRESOLVED',         -- llamada con intención de agendar sin cita creada
  'APPOINTMENT_CANCELLED',          -- cita cancelada → reagendar
  'APPOINTMENT_NO_SHOW',            -- paciente no se presentó
  'REMINDER_NO_RESPONSE',           -- recordatorio sin confirmar → llamar
  'POST_TREATMENT_FOLLOWUP',        -- llamada postoperatoria 24/48h
  'PENDING_TREATMENT_UNSCHEDULED',  -- presupuesto aceptado sin cita futura
  'PATIENT_INACTIVE',               -- paciente sin visita hace N meses → reactivación
  'WHATSAPP_HANDOFF',               -- conversación escalada a humano
  'WAITLIST_ACCEPTED_UNSCHEDULED'   -- aceptó hueco de waitlist y no quedó agendado
);

-- ─── Plantillas de rutina (SOPs ejecutables) ─────────────────────────────────
CREATE TABLE task_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Clave estable del catálogo semilla ('apertura', 'cierre', 'esterilizacion-ciclo'...).
  -- NULL = plantilla creada a mano por la clínica.
  key text,
  name text NOT NULL,
  description text,
  category task_category NOT NULL DEFAULT 'ADMIN',
  priority task_priority NOT NULL DEFAULT 'MEDIUM',
  recurrence_freq task_recurrence_freq NOT NULL DEFAULT 'DAILY',
  -- Cada N periodos (1 = todos los días / semanas / meses).
  recurrence_interval integer NOT NULL DEFAULT 1,
  -- Para WEEKLY: días ISO 1=lunes .. 7=domingo. Vacío = el día de creación.
  recurrence_weekdays integer[] NOT NULL DEFAULT '{}',
  -- Para MONTHLY/QUARTERLY/YEARLY: día del mes (1-28 para no romper febrero).
  recurrence_month_day integer,
  -- Para YEARLY: mes 1-12.
  recurrence_month integer,
  -- Hora local de vencimiento 'HH:MM' en la timezone de la clínica.
  due_time text NOT NULL DEFAULT '09:00',
  -- Cuántos días antes del vencimiento aparece la tarea en el tablero.
  lead_days integer NOT NULL DEFAULT 0,
  -- Rol al que se auto-asigna si no hay usuario concreto.
  default_role text,
  default_assignee_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Exige nota o evidencia para poder cerrarla (obligatorio en cumplimiento).
  requires_evidence boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  -- Plantilla del catálogo Futura: se puede desactivar y editar, no borrar.
  is_system boolean NOT NULL DEFAULT false,
  -- Última fecha local (YYYY-MM-DD) materializada. Corta trabajo del worker.
  last_materialized_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX task_templates_tenant_key_unique
  ON task_templates (tenant_id, key)
  WHERE key IS NOT NULL;
CREATE INDEX task_templates_tenant_enabled_idx ON task_templates (tenant_id, enabled);

CREATE TABLE task_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
  content text NOT NULL,
  "order" integer NOT NULL DEFAULT 0
);
CREATE INDEX task_template_items_template_idx ON task_template_items (template_id, "order");

-- ─── Reglas de automatización ────────────────────────────────────────────────
CREATE TABLE task_automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trigger task_automation_trigger NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  -- Título con variables {{patientName}}, {{phone}}, {{date}}, {{treatment}}.
  title_template text NOT NULL,
  description_template text,
  category task_category NOT NULL DEFAULT 'PATIENT',
  priority task_priority NOT NULL DEFAULT 'HIGH',
  -- Minutos desde la creación hasta el vencimiento (SLA). 120 = 2h.
  due_offset_minutes integer NOT NULL DEFAULT 120,
  assignee_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  assignee_role text,
  requires_evidence boolean NOT NULL DEFAULT false,
  -- Parámetros propios del trigger (ej. { "inactiveMonths": 12 }).
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, trigger)
);

-- ─── Tareas ──────────────────────────────────────────────────────────────────
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  category task_category NOT NULL DEFAULT 'ADMIN',
  priority task_priority NOT NULL DEFAULT 'MEDIUM',
  status task_status NOT NULL DEFAULT 'TODO',
  -- Orden dentro de la columna del tablero. Float para insertar entre dos
  -- sin reescribir toda la columna en cada drag.
  board_position double precision NOT NULL DEFAULT 1000,
  due_at timestamptz,
  -- true = "vence ese día" sin hora concreta (no muestra reloj en la card).
  due_all_day boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  completed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  source task_source NOT NULL DEFAULT 'MANUAL',
  template_id uuid REFERENCES task_templates(id) ON DELETE SET NULL,
  automation_trigger task_automation_trigger,
  dedupe_key text,
  requires_evidence boolean NOT NULL DEFAULT false,
  evidence_note text,
  labels text[] NOT NULL DEFAULT '{}',
  -- ─ Vínculos con el resto del producto (sin FK dura: las cachés se rebuildean)
  patient_ghl_contact_id text,
  patient_name text,
  patient_phone text,
  call_id uuid REFERENCES calls(id) ON DELETE SET NULL,
  whatsapp_conversation_id uuid REFERENCES whatsapp_conversations(id) ON DELETE SET NULL,
  ghl_appointment_id text,
  reminder_id uuid,
  waitlist_entry_id uuid,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tasks_tenant_dedupe_unique
  ON tasks (tenant_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX tasks_tenant_status_pos_idx ON tasks (tenant_id, status, board_position);
CREATE INDEX tasks_tenant_due_idx ON tasks (tenant_id, due_at) WHERE archived_at IS NULL;
CREATE INDEX tasks_tenant_patient_idx ON tasks (tenant_id, patient_ghl_contact_id);
CREATE INDEX tasks_tenant_source_idx ON tasks (tenant_id, source, created_at);

-- ─── Asignados (N a N) ───────────────────────────────────────────────────────
CREATE TABLE task_assignees (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX task_assignees_user_idx ON task_assignees (user_id);
CREATE INDEX task_assignees_tenant_idx ON task_assignees (tenant_id);

-- ─── Checklist (alimenta la barra de progreso de la card) ────────────────────
CREATE TABLE task_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  content text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  done_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  "order" integer NOT NULL DEFAULT 0
);
CREATE INDEX task_checklist_task_idx ON task_checklist_items (task_id, "order");

-- ─── Comentarios + timeline de actividad (accountability) ────────────────────
CREATE TABLE task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- 'comment' = escrito por una persona · 'activity' = evento del sistema.
  kind text NOT NULL DEFAULT 'comment',
  body text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_comments_task_idx ON task_comments (task_id, created_at);
