-- Recordatorios de Respinens (documento "WhatsApp IA 2"):
--
-- 1. Al reservar (WhatsApp, teléfono o panel) el aviso nuevo: cambios con 6 h,
--    confirmación OBLIGATORIA el día de la cita (si no, a las 12:30 se anula)
--    y ayuno. La primera visita además recibe la dirección.
-- 2. El día de la cita: 08:00 recordatorio con Confirmar / Modificar /
--    Cancelar; 09:00 segundo aviso; 11:00 y 12:00 aviso al equipo para
--    llamar; 12:30 la cita se anula y se le avisa. Al confirmar: "Perfecto 😊
--    Nos vemos esta tarde…" y, si es primera visita, la info de la sesión.
-- 3. Esta secuencia sustituye a los recordatorios por reglas de la clínica:
--    se apagan sus conjuntos y se cancelan los programados, para que no le
--    lleguen dos recordatorios distintos.

CREATE TABLE IF NOT EXISTS appointment_day_of (
  appointment_id uuid PRIMARY KEY REFERENCES agenda_appointments(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reminder_sent_at timestamptz,
  nudge_sent_at timestamptz,
  calls_done integer NOT NULL DEFAULT 0,
  outcome text,
  outcome_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appointment_day_of_tenant_idx ON appointment_day_of (tenant_id);

UPDATE tenant_care_profile
SET message_scripts = (message_scripts - 'dayConfirmed') || jsonb_build_object(
  'firstVisitBooked', jsonb_build_array(
$a1$Ya tienes la cita reservada para {{paciente}}

🗓️ {{fecha}}
⏰ {{hora}}$a1$,
$pol$· _Los cambios y anulaciones se deben avisar con un mínimo de *6 HORAS DE ANTELACIÓN*._

· _El día de la cita, recibirás un WhatsApp. Es *obligatorio* responder para confirmar la asistencia. En caso de no contestar, a las 12:30 la cita quedará anulada._
_Si has reservado varias citas, tienes que contestar a todas._

🍼🚫 Recuerda: 2 horas de ayuno antes de la sesión

Muchas gracias✨$pol$,
$dir$Avenida Carmen Martin Gaite 17, 28919, Leganés (Madrid)$dir$
  ),
  'returningBooked', jsonb_build_array(
$b1$Ya tienes la cita reservada para {{paciente}}

🗓️ {{fecha}}
⏰ {{hora}}$b1$,
$pol$· _Los cambios y anulaciones se deben avisar con un mínimo de *6 HORAS DE ANTELACIÓN*._

· _El día de la cita, recibirás un WhatsApp. Es *obligatorio* responder para confirmar la asistencia. En caso de no contestar, a las 12:30 la cita quedará anulada._
_Si has reservado varias citas, tienes que contestar a todas._

🍼🚫 Recuerda: 2 horas de ayuno antes de la sesión

Muchas gracias✨$pol$
  ),
  'dayOf', jsonb_build_object(
    'reminderAt', '08:00',
    'nudgeAt', '09:00',
    'callAt', jsonb_build_array('11:00', '12:00'),
    'cancelAt', '12:30',
    'reminder', $r$Te recordamos tu cita de hoy a las {{hora}}

‼️⚠️ LA CONFIRMACIÓN A ESTE MENSAJE ES OBLIGATORIA ⚠️‼️

Muchas gracias✨$r$,
    'nudge', $n$Buenos días, necesitamos *confirmar* la asistencia a la cita de hoy. Por favor, contéstanos lo antes posible.

Muchas gracias 😊

_Nota: Te reservamos la cita de tu peque hasta las 12:30 de la mañana. Si a esta hora no hemos recibido respuesta, quedará anulada._$n$,
    'confirmed', $c$Perfecto 😊 Nos vemos {{cuando}}.

Recuerda:
- 🍼🚫 2 HORAS DE AYUNO
- 🕑 PUNTUALIDAD

Muchas gracias✨$c$,
    'firstVisitInfo', $i$Info importante para la sesión:

👉🏻 Hay que acudir con *2 HORAS DE AYUNO* para evitar posibles vómitos.

🕒 La duración de la primera visita es aprox. 30-40 minutos. Además de realizar el tratamiento, se elabora la historia clínica, os explicamos cómo hacer lavados nasales correctamente, además de dar más consejos importantes.

💞👶🏽 Las maniobras finales que se realizan *no son dolorosas* aunque resulten incómodas.

🚙 Para aparcar no hay problema. Hay sitio en la puerta de la clínica a cualquier hora y no hay parquímetro 😊$i$,
    'cancelled', $x$Muchas gracias por avisarnos con tiempo✨ Cancelamos la cita de {{paciente}}. Si necesitas volver a agendar otra, vuelve a contactar con nosotras 😊$x$,
    'autoCancelled', $ac$La cita queda *anulada*. Si necesitas volver a agendar otra, ponte en contacto con nosotras y buscamos otro hueco. Un saludo 😊$ac$
  )
),
updated_at = now()
WHERE message_scripts IS NOT NULL
  AND NOT (message_scripts ? 'dayOf');

UPDATE reminder_rule_sets rs
SET enabled = false,
    updated_at = now()
FROM tenant_care_profile cp
WHERE cp.tenant_id = rs.tenant_id
  AND cp.message_scripts ? 'dayOf'
  AND rs.enabled = true;

UPDATE appointment_reminders r
SET status = 'CANCELLED',
    updated_at = now()
FROM tenant_care_profile cp
WHERE cp.tenant_id = r.tenant_id
  AND cp.message_scripts ? 'dayOf'
  AND r.status = 'SCHEDULED';
