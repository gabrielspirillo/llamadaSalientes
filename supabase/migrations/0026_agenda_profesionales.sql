-- ─────────────────────────────────────────────────────────────────────────────
-- Módulo Agenda (core, sin gate de enabled_modules).
--
-- Hasta aquí la agenda de la clínica vivía en GoHighLevel: los calendarios, los
-- huecos y las citas eran de un CRM externo, y el panel sólo leía una réplica
-- (`appointments_cache`). Eso deja tres cosas fuera de la plataforma:
--
--   1. El profesional. No existía como entidad: `treatments.assigned_dentists`
--      era una lista de texto suelta. No se podía decir "la Dra. Ruiz hace
--      ortodoncia los martes de 9 a 14 y el 12 de octubre no viene".
--   2. La agenda editable. Días, horas, duración del hueco, descansos y
--      bloqueos son decisiones de la clínica, no del CRM.
--   3. La historia clínica. Lo que el profesional escribe DESPUÉS de atender
--      es el activo de la clínica y no puede estar en un sistema ajeno.
--
-- A partir de esta migración la agenda es de la plataforma. GHL sigue
-- funcionando como antes para las clínicas que lo tengan conectado: la agenda
-- interna manda sólo cuando la clínica habilita al menos un profesional
-- (`professionals.agenda_enabled`), y si no hay ninguno todo cae al camino GHL
-- de siempre. Ver `lib/agenda/availability.ts` y `lib/retell/tools.ts`.
--
-- Convenciones que se repiten abajo:
--   - Los días de la semana son ISO: 1 = lunes … 7 = domingo, igual que
--     `lib/tasks/tz.ts`. Guardar 0 = domingo obligaría a dos convenciones.
--   - Las horas de trabajo se guardan como MINUTOS DESDE MEDIANOCHE en hora
--     local de la clínica (`start_minute` / `end_minute`), no como timestamps:
--     "de 9 a 14 los martes" no es un instante, es una hora de pared, y tiene
--     que seguir siendo las 9 después del cambio de horario. La conversión a
--     UTC se hace al calcular huecos, con la timezone de `clinic_settings`.
--   - Las citas y los bloqueos SÍ son instantes: timestamptz.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Enums ───────────────────────────────────────────────────────────────────

-- Qué ve en el panel un profesional que además tiene usuario en la plataforma.
--   AGENDA_ONLY — su agenda, sus pacientes y sus notas clínicas. Nada más.
--   FULL        — además, el resto del panel (el socio de la clínica que
--                 también pasa consulta).
CREATE TYPE professional_panel_access AS ENUM ('AGENDA_ONLY', 'FULL');

CREATE TYPE agenda_appointment_status AS ENUM (
  'SCHEDULED',    -- agendada, sin confirmar
  'CONFIRMED',    -- el paciente confirmó
  'ARRIVED',      -- está en la clínica
  'IN_PROGRESS',  -- entrando a gabinete
  'COMPLETED',    -- atendida (habilita la nota clínica)
  'CANCELLED',
  'NO_SHOW'
);

-- De dónde salió la cita. Importa para métricas y para saber a quién reclamarle
-- un hueco mal dado: no es lo mismo lo que agendó recepción que lo que agendó
-- el agente de voz solo.
CREATE TYPE agenda_appointment_source AS ENUM (
  'PANEL',           -- alguien del equipo desde el panel
  'VOICE_AGENT',     -- agente de voz (Retell)
  'WHATSAPP_AGENT',  -- agente de WhatsApp
  'WAITLIST',        -- hueco liberado que aceptó un paciente en lista de espera
  'IMPORT'           -- carga externa / GHL
);

CREATE TYPE agenda_block_kind AS ENUM (
  'TIME_OFF',  -- vacaciones, día libre, permiso
  'HOLIDAY',   -- festivo
  'BREAK',     -- comida, formación, reunión
  'OTHER'
);

-- ─── Profesionales ───────────────────────────────────────────────────────────
-- Un profesional puede existir SIN usuario de la plataforma (la clínica lleva
-- su agenda pero él no entra al panel). `user_id` lo vincula cuando sí entra;
-- es opcional a propósito.
CREATE TABLE IF NOT EXISTS professionals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text,
  phone text,
  specialty text,
  license_number text,
  -- Color con el que se pinta en el calendario. Es lo que hace legible la
  -- vista "todos los profesionales".
  color text NOT NULL DEFAULT '#37766a',
  active boolean NOT NULL DEFAULT true,
  -- El interruptor de "habilitar la agenda de este profesional". Apagado, el
  -- profesional existe (para asignarle tratamientos o histórico) pero no se le
  -- pueden dar huecos ni los agentes lo ofrecen.
  agenda_enabled boolean NOT NULL DEFAULT false,
  panel_access professional_panel_access NOT NULL DEFAULT 'AGENDA_ONLY',
  -- Null = hereda la timezone de clinic_settings. Se deja por si una clínica
  -- tiene profesionales en otra ciudad.
  timezone text,
  -- Rejilla de huecos que se ofrece (cada cuánto empieza una cita).
  slot_granularity_minutes integer NOT NULL DEFAULT 15,
  -- Minutos muertos que se reservan DESPUÉS de cada cita (limpieza de gabinete).
  buffer_minutes integer NOT NULL DEFAULT 0,
  -- No ofrecer huecos con menos de N horas de antelación…
  min_notice_hours integer NOT NULL DEFAULT 2,
  -- …ni más allá de N días.
  max_advance_days integer NOT NULL DEFAULT 90,
  -- Si false, la agenda se gestiona sólo a mano: los agentes virtuales pueden
  -- CONSULTARLA pero no reservar en ella.
  accepts_online_booking boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS professionals_tenant_idx ON professionals (tenant_id, active);
-- Un usuario de la plataforma es como mucho UN profesional dentro de la misma
-- clínica: si no, "mi agenda" sería ambigua.
CREATE UNIQUE INDEX IF NOT EXISTS professionals_tenant_user_uniq
  ON professionals (tenant_id, user_id) WHERE user_id IS NOT NULL;

-- ─── Tratamientos que realiza cada profesional ───────────────────────────────
-- El catálogo de tratamientos ya se carga en el onboarding; aquí sólo se marca
-- cuáles hace cada uno. La duración puede diferir por profesional (un implante
-- con el cirujano veterano no dura lo mismo), de ahí el override.
CREATE TABLE IF NOT EXISTS professional_treatments (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  treatment_id uuid NOT NULL REFERENCES treatments(id) ON DELETE CASCADE,
  duration_override_minutes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (professional_id, treatment_id)
);

CREATE INDEX IF NOT EXISTS professional_treatments_tenant_idx
  ON professional_treatments (tenant_id, treatment_id);

-- ─── Horario semanal ─────────────────────────────────────────────────────────
-- Varias franjas por día: "martes 9:00-14:00" y "martes 16:00-20:00" son dos
-- filas. Así la comida es simplemente el hueco entre franjas y no hace falta
-- modelarla como excepción.
CREATE TABLE IF NOT EXISTS professional_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7), -- ISO: 1=lunes
  start_minute integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
  end_minute integer NOT NULL CHECK (end_minute BETWEEN 0 AND 1440),
  -- Vigencia opcional: sirve para cambios de horario a partir de una fecha sin
  -- perder el histórico del anterior.
  valid_from date,
  valid_until date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_minute > start_minute)
);

CREATE INDEX IF NOT EXISTS professional_shifts_prof_idx
  ON professional_shifts (professional_id, weekday);
CREATE INDEX IF NOT EXISTS professional_shifts_tenant_idx
  ON professional_shifts (tenant_id);

-- ─── Bloqueos (lo que NO se puede agendar) ───────────────────────────────────
-- Vacaciones, festivos, una tarde de formación. Son instantes, no horas de
-- pared: un bloqueo empieza y termina en un momento concreto.
CREATE TABLE IF NOT EXISTS professional_time_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  kind agenda_block_kind NOT NULL DEFAULT 'TIME_OFF',
  reason text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS professional_time_off_prof_idx
  ON professional_time_off (professional_id, starts_at);
CREATE INDEX IF NOT EXISTS professional_time_off_tenant_idx
  ON professional_time_off (tenant_id, starts_at);

-- ─── Citas ───────────────────────────────────────────────────────────────────
-- El paciente se guarda DESNORMALIZADO (nombre, teléfono, email) además del id
-- del CRM: la clínica puede no tener GHL conectado, y aun teniéndolo la cita no
-- puede quedar ilegible si el contacto se borra allí.
--
-- `patient_key` es la identidad estable del paciente dentro del tenant:
-- el id de contacto del CRM si lo hay, y si no el teléfono normalizado. Es lo
-- que agrupa la historia clínica. Lo calcula la app (`lib/agenda/patients.ts`),
-- no la base, porque la normalización de teléfonos ya vive en TypeScript.
CREATE TABLE IF NOT EXISTS agenda_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  treatment_id uuid REFERENCES treatments(id) ON DELETE SET NULL,
  patient_key text NOT NULL,
  patient_name text NOT NULL,
  patient_phone text,
  patient_email text,
  ghl_contact_id text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status agenda_appointment_status NOT NULL DEFAULT 'SCHEDULED',
  source agenda_appointment_source NOT NULL DEFAULT 'PANEL',
  title text,
  notes text,             -- lo que se sabe ANTES de atender (motivo, avisos)
  cancel_reason text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Idempotencia para los agentes virtuales y los reintentos de cola: dos
  -- llamadas al mismo tool con la misma clave no crean dos citas.
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

-- La consulta que manda: "la agenda de este profesional en este rango".
CREATE INDEX IF NOT EXISTS agenda_appointments_prof_idx
  ON agenda_appointments (professional_id, starts_at);
-- La vista "todos los profesionales" de un día.
CREATE INDEX IF NOT EXISTS agenda_appointments_tenant_idx
  ON agenda_appointments (tenant_id, starts_at);
-- "Las citas de este paciente" (ficha + historia clínica).
CREATE INDEX IF NOT EXISTS agenda_appointments_patient_idx
  ON agenda_appointments (tenant_id, patient_key, starts_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS agenda_appointments_dedupe_uniq
  ON agenda_appointments (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ─── Historia clínica ────────────────────────────────────────────────────────
-- Lo que el profesional escribe DESPUÉS de atender. Va atada a la cita cuando
-- la hay (`appointment_id`), pero puede existir suelta: una urgencia sin cita
-- previa también se registra.
--
-- Se guarda `patient_key` además del id de la cita porque la historia se lee
-- por paciente, y una cita borrada no puede llevarse por delante la nota.
CREATE TABLE IF NOT EXISTS clinical_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES agenda_appointments(id) ON DELETE SET NULL,
  patient_key text NOT NULL,
  patient_name text,
  -- Motivo de consulta / diagnóstico.
  summary text NOT NULL,
  -- Qué se hizo.
  treatment_performed text,
  observations text,
  -- Qué toca la próxima vez. Es lo que recepción y los agentes necesitan leer.
  next_steps text,
  -- Una nota privada NO se le enseña a los agentes virtuales ni al resto del
  -- equipo: es la valoración personal del profesional.
  private boolean NOT NULL DEFAULT false,
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clinical_notes_patient_idx
  ON clinical_notes (tenant_id, patient_key, created_at DESC);
CREATE INDEX IF NOT EXISTS clinical_notes_prof_idx
  ON clinical_notes (professional_id, created_at DESC);
CREATE INDEX IF NOT EXISTS clinical_notes_appointment_idx
  ON clinical_notes (appointment_id);
