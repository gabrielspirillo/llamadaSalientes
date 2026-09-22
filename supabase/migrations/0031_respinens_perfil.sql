-- Siembra del perfil de atención de Respinens (fisioterapia respiratoria
-- pediátrica, 0 a 4 años).
--
-- Es la ÚNICA clínica con perfil. No hay botón en el panel: la fila se crea
-- aquí, con el slug de su organización en Clerk, y se queda. Idempotente: si
-- la fila ya existe no se toca, para que un ajuste hecho a mano después no se
-- pierda en el siguiente arranque del worker.
--
-- Si el slug no coincidiera con ninguna clínica (un error al copiarlo), se cae
-- a "la única clínica cuyo nombre empieza por Respinens". Si hubiera más de
-- una, no se siembra nada: antes ninguna que la equivocada.

WITH por_slug AS (
  SELECT id FROM tenants WHERE slug = 'respinens-logo-1789808641416119420'
),
por_nombre AS (
  SELECT id FROM tenants WHERE lower(name) LIKE 'respinens%'
),
objetivo AS (
  SELECT id FROM por_slug
  UNION ALL
  SELECT id FROM por_nombre
  WHERE NOT EXISTS (SELECT 1 FROM por_slug)
    AND (SELECT count(*) FROM por_nombre) = 1
)
INSERT INTO tenant_care_profile (tenant_id, profile, booking_policy, anamnesis_template, first_visit_protocol)
SELECT
  id,
  'PEDIATRIC',
  -- Reglas de reserva. Minutos locales: 1140 = 19:00.
  '{
    "maxConsecutiveFirstVisits": 2,
    "firstVisitBlackouts": [
      { "weekday": 1, "fromMinute": 1140, "toMinute": 1440 },
      { "weekday": 3, "fromMinute": 1140, "toMinute": 1440 }
    ],
    "patientAgeMonths": { "min": 0, "max": 59 },
    "fastingHours": 2,
    "priorityAgeMonths": { "veryHighMax": 6, "highMax": 24 },
    "siblingsConsecutive": true
  }'::jsonb,
  -- La anamnesis que se ve al abrir cada paciente, en el orden que la pidió.
  '[
    { "key": "sano", "label": "Sano" },
    { "key": "enfermedad_importante", "label": "Enfermedad importante" },
    { "key": "prematuro", "label": "Prematuro" },
    { "key": "ingresos", "label": "Ingresos" },
    { "key": "vacuna_vrs", "label": "Vacuna VRS" },
    { "key": "alergias", "label": "Alergias" },
    { "key": "pa", "label": "PA" },
    { "key": "rge", "label": "RGE" },
    { "key": "antecedentes", "label": "Antecedentes" },
    { "key": "hermanos", "label": "Hermanos" },
    { "key": "fumadores", "label": "Fumadores" },
    { "key": "guarderia", "label": "Guardería" },
    { "key": "cap", "label": "CAP" }
  ]'::jsonb,
  -- Lo que los asistentes (voz y WhatsApp) preguntan y dicen en una primera
  -- visita. Se inyecta tal cual en el prompt; las reglas que no pueden
  -- depender del modelo (edad, exclusiones) las impone además el servidor.
  $protocolo$
En una PRIMERA VISITA (el paciente no está dado de alta), antes de dar hora:
- Pregunta la edad del niño o de la niña. Sólo se atiende a bebés y niños de 0 a 4 años (incluidos). Si es mayor, explícalo con amabilidad y no des cita.
- Informa de que hay que venir con 2 horas de ayuno obligatorio, para evitar vómitos. Puede beber agua, pero en pequeñas cantidades, a sorbitos.
- Tranquiliza a quien llama: la sesión no duele en ningún momento, y en la clínica se explica todo con detalle antes de empezar.
- Pide el nombre y los apellidos del niño, su fecha de nacimiento y el nombre del titular del teléfono, para guardar el contacto.
- Informa de que no hay problema de aparcamiento: se aparca en la misma calle de la clínica y no hay parquímetro.
- Pregunta si son gemelos o mellizos. Si es así, cada niño va en una hora distinta pero seguidas, salvo que sólo quieran cita para uno o prefieran horarios distintos.
- Pregunta si el niño tiene alguna enfermedad importante, si viene de un ingreso, o si tiene TDAH, autismo u otra condición parecida. En ese caso NO des cita: pasa la conversación a una persona del equipo.
$protocolo$
FROM objetivo
ON CONFLICT (tenant_id) DO NOTHING;
