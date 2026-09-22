-- Perfil de atención por clínica y el paciente como persona.
--
-- Hasta aquí la plataforma daba por hecho que un teléfono es un paciente: la
-- libreta (`whatsapp_contacts`) es única por (clínica, teléfono) y la identidad
-- clínica de la agenda es `tel:+34…`. En una clínica pediátrica eso no se
-- sostiene: el móvil es de la madre o del padre, y detrás de un mismo número
-- hay hermanos —y gemelos que se agendan en horas seguidas—. Con el modelo
-- viejo, los dos compartirían historia clínica, edad y cumpleaños.
--
-- Esta migración añade dos cosas y no cambia nada para quien no las use:
--
--   1. `tenant_care_profile`: cómo atiende ESTA clínica. Una fila por clínica y,
--      sin fila, todo sigue exactamente como hoy. No hay interruptor en el
--      panel: la fila la siembra una migración con el slug de la clínica que
--      lo pidió, y el resto del código sólo pregunta "¿hay perfil?".
--   2. `patients`: la persona atendida, separada del contacto que llama. Cuelga
--      del tutor (`contact_id` → whatsapp_contacts) y tiene lo que un contacto
--      no puede tener: fecha de nacimiento, madre y padre, anamnesis, prioridad
--      y las marcas de la ficha. Su identidad en la agenda es `pat:<id>`.
--
-- Las citas y las notas ganan `patient_id` (nullable): para las clínicas que
-- siguen con el contacto como paciente queda a NULL y su `patient_key` no
-- cambia. `is_first_visit` se calcula al crear la cita —el paciente no tenía
-- ninguna cita anterior— y es lo que sostiene las reglas de "no más de dos
-- primeras visitas seguidas" y "los lunes por la tarde no se dan primeras".

-- ─── Perfil de atención ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_care_profile (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Único perfil hoy. Se deja como texto con CHECK para poder añadir otros sin
  -- tocar un enum.
  profile text NOT NULL DEFAULT 'PEDIATRIC',
  -- Reglas de reserva. La forma la fija `lib/care-profile/policy.ts`; una fila
  -- con claves que el código no conozca se lee con los valores por defecto.
  booking_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Ítems de la anamnesis: [{ key, label }]. Es lo que se pinta arriba de la
  -- ficha de cada paciente.
  anamnesis_template jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Lo que los asistentes tienen que preguntar y decir en una primera visita.
  -- Se inyecta tal cual en el prompt.
  first_visit_protocol text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (profile IN ('PEDIATRIC'))
);

COMMENT ON TABLE tenant_care_profile IS
  'Cómo atiende esta clínica. Sin fila = comportamiento general de la plataforma.';

-- ─── Pacientes ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- El tutor: la ficha de contacto (teléfono) desde la que se llama o escribe.
  -- SET NULL y no CASCADE: perder el contacto no puede borrar la historia del
  -- niño.
  contact_id uuid REFERENCES whatsapp_contacts(id) ON DELETE SET NULL,
  first_name text NOT NULL,
  last_name text,
  birth_date date,
  -- [{ role: 'MADRE' | 'PADRE' | 'NINGUNO', name }], como mucho dos.
  guardians jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- { <key de la plantilla>: { value: true | false | null, detail: '' } }
  anamnesis jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Marcado a mano como prioritario, con el motivo (lo leen los asistentes).
  priority_flag boolean NOT NULL DEFAULT false,
  priority_reason text,
  -- Dejó reseña en Google.
  google_review boolean NOT NULL DEFAULT false,
  -- El tutor contó algo (enfermedad importante, ingreso reciente, TDAH,
  -- autismo…) que la clínica quiere valorar en persona antes de dar cita. Lo
  -- marcan los asistentes; los agentes no reservan mientras esté en true.
  needs_human_review boolean NOT NULL DEFAULT false,
  review_reason text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patients_tenant_idx ON patients (tenant_id, active);
CREATE INDEX IF NOT EXISTS patients_contact_idx ON patients (contact_id);
-- Cumpleaños del día: mes y día sin el año. `extract` sobre date es inmutable,
-- `to_char` no (depende de la configuración regional) y no se puede indexar.
CREATE INDEX IF NOT EXISTS patients_birthday_idx
  ON patients (tenant_id, (extract(month FROM birth_date)), (extract(day FROM birth_date)))
  WHERE birth_date IS NOT NULL;

COMMENT ON COLUMN patients.contact_id IS
  'Tutor o titular del teléfono (whatsapp_contacts). Varios pacientes pueden colgar del mismo contacto.';
COMMENT ON COLUMN patients.guardians IS
  '[{ role: MADRE | PADRE | NINGUNO, name }]. Hasta dos: mamá y papá, dos mamás, dos papás o una sola persona.';

-- ─── Citas y notas ───────────────────────────────────────────────────────────

ALTER TABLE agenda_appointments
  ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_first_visit boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS agenda_appointments_patient_id_idx
  ON agenda_appointments (patient_id, starts_at)
  WHERE patient_id IS NOT NULL;

-- Backfill: la primera cita que ocupa hueco de cada paciente fue su primera
-- visita. Es un hecho, no una regla: sólo las clínicas con perfil lo usan.
UPDATE agenda_appointments a
SET is_first_visit = true
WHERE a.status IN ('SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED')
  AND a.patient_key <> 'anon:sin-datos'
  AND NOT EXISTS (
    SELECT 1
    FROM agenda_appointments b
    WHERE b.tenant_id = a.tenant_id
      AND b.patient_key = a.patient_key
      AND b.id <> a.id
      AND b.status IN ('SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED')
      AND b.starts_at < a.starts_at
  );

COMMENT ON COLUMN agenda_appointments.is_first_visit IS
  'El paciente no tenía ninguna cita anterior al crear ésta. Se fija al crearla.';

ALTER TABLE clinical_notes
  ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
  -- Lo que cuenta la familia y lo que encuentra el profesional, separados del
  -- diagnóstico. Sólo los pinta la ficha de las clínicas con perfil.
  ADD COLUMN IF NOT EXISTS symptoms text,
  ADD COLUMN IF NOT EXISTS examination text,
  -- Cómo se portó en la sesión: GREEN | YELLOW | RED. Por sesión, no por
  -- paciente: un niño que lloró a los tres meses se ríe a los dos años.
  ADD COLUMN IF NOT EXISTS session_behavior text;

DO $$
BEGIN
  ALTER TABLE clinical_notes
    ADD CONSTRAINT clinical_notes_session_behavior_check
    CHECK (session_behavior IS NULL OR session_behavior IN ('GREEN', 'YELLOW', 'RED'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS clinical_notes_patient_id_idx
  ON clinical_notes (patient_id, created_at DESC)
  WHERE patient_id IS NOT NULL;
