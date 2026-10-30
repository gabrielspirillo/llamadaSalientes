-- Respinens: los guiones vuelven a ser los del documento "Recordatorios".
--
-- Al reservar, la clínica manda UN mensaje (cita + cambios con 6 horas + el
-- WhatsApp obligatorio del día + ayuno + gracias), y en una primera visita
-- además la dirección. Hasta ahora salían partidos en dos.
--
-- El protocolo de primera visita pedía el nombre de quien escribe y decía
-- "si es mayor, explícalo": el asistente lo pedía en un mensaje aparte y
-- calculaba él la edad (mal). Ahora pide nombre, apellidos y fecha de
-- nacimiento juntos, y la edad la decide el sistema.

UPDATE tenant_care_profile
SET message_scripts = message_scripts || jsonb_build_object(
  'firstVisitBooked', jsonb_build_array(
$a$Ya tienes la cita reservada para {{paciente}}

🗓️ {{fecha}}
⏰ {{hora}}

· _Los cambios y anulaciones se deben avisar con un mínimo de *6 HORAS DE ANTELACIÓN*._

· _El día de la cita, recibirás un WhatsApp. Es *obligatorio* responder para confirmar la asistencia. En caso de no contestar, a las 12:30 la cita quedará anulada._
_Si has reservado varias citas, tienes que contestar a todas._

🍼🚫 Recuerda: 2 horas de ayuno antes de la sesión

Muchas gracias✨$a$,
$dir$Avenida Carmen Martin Gaite 17, 28919, Leganés (Madrid)$dir$
  ),
  'returningBooked', jsonb_build_array(
$b$Ya tienes la cita reservada para {{paciente}}

🗓️ {{fecha}}
⏰ {{hora}}

· _Los cambios y anulaciones se deben avisar con un mínimo de *6 HORAS DE ANTELACIÓN*._

· _El día de la cita, recibirás un WhatsApp. Es *obligatorio* responder para confirmar la asistencia. En caso de no contestar, a las 12:30 la cita quedará anulada._
_Si has reservado varias citas, tienes que contestar a todas._

🍼🚫 Recuerda: 2 horas de ayuno antes de la sesión

Muchas gracias✨$b$
  )
),
first_visit_protocol = $p$
En una PRIMERA VISITA pide en UN solo mensaje lo que no esté ya en la ficha: nombre y apellidos del peque y su fecha de nacimiento. Con eso llama a register_patient: él dice si la edad entra.
Si son gemelos o mellizos, cada peque va en una hora distinta pero seguidas, salvo que pidan otra cosa.
No hagas preguntas médicas. Si cuentan una enfermedad importante o un ingreso reciente, pásalo en medical_alert de register_patient (no se da cita y lo valora Raquel). Mocos, tos o catarro no: sigue con la cita.
$p$,
updated_at = now()
WHERE message_scripts ? 'dayOf';
