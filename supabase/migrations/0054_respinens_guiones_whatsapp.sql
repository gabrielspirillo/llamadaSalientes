-- Guiones de WhatsApp de Respinens (documento "Petición de cita"): el saludo
-- al pedir cita, los mensajes tras reservar (A: primera visita de cero; B:
-- paciente que vuelve o primera visita de un hermano de alguien que ya vino)
-- y las respuestas cortas de siempre. Los de la reserva los manda la app con
-- el texto exacto; el resto entra en el prompt del asistente de WhatsApp.
--
-- El ayuno, la duración, que no duele y el aparcamiento van ahora en la
-- confirmación, así que el protocolo de primera visita deja de pedir al
-- asistente que lo cuente antes de reservar (salía dos veces).

ALTER TABLE tenant_care_profile ADD COLUMN IF NOT EXISTS message_scripts jsonb;

UPDATE tenant_care_profile
SET message_scripts = jsonb_build_object(
  'greeting', $g$Hola😊, vas a agendar una cita en Respinens🩺 ¿Es la primera vez que acudes a la clínica?
· Sí, es la primera visita
· No, ya he ido
· No, ya he acudido pero con otro peque (hermano mayor)

‼️ _SI HAY FIEBRE SUPERIOR A 38.5º O DIFICULTAD RESPIRATORIA *NO SE PUEDE REALIZAR LA SESIÓN*_$g$,
  'firstVisitBooked', jsonb_build_array(
$a1$Ya tienes la cita reservada para {{paciente}}:
🗓️ {{fecha}}
⏰ {{hora}}$a1$,
$a2$👉🏻 Hay que acudir a la sesión con *2 HORAS DE AYUNO* para evitar posibles vómitos (si se puede beber agua en pequeñas cantidades)

🕒 La duración de la visita es aprox. 30-40 minutos. Además de realizar el tratamiento, se elabora la historia clínica del niño, os explicamos cómo hacer lavados nasales correctamente y más consejos importantes.

💞👶🏽 Las maniobras que se realizan *no son dolorosas* aunque resulten incómodas.

🚙 Para aparcar no hay problema. Hay sitio en la puerta de la clínica y no hay parquímetro

‼️ _Los cambios y anulaciones se deben avisar con un mínimo de *6 HORAS DE ANTELACIÓN*. En caso contrario, se abonará el importe íntegro de la sesión_.

Muchas gracias✨$a2$,
$a3$Avenida Carmen Martin Gaite 17, 28919, Leganés (Madrid)$a3$
  ),
  'returningBooked', jsonb_build_array(
$b1$Ya tienes la cita reservada para {{paciente}}:
🗓️ {{fecha}}
⏰ {{hora}}$b1$,
$b2$_Los cambios y anulaciones se deben avisar con un mínimo de *6 HORAS DE ANTELACIÓN*. En caso contrario, se abonará el importe íntegro de la sesión_.

🚫 Recuerda: acudir con *2 horas de ayuno*

Muchas gracias✨$b2$
  ),
  'thanks', 'Muchas gracias a ti 💗',
  'cancelled', 'Muchas gracias por avisarnos con tiempo✨ Cancelamos la cita de (nombre). Si necesitas volver a agendar otra, vuelve a contactar con nosotras 😊',
  'sick', 'Esperamos que (nombre) se recupere prontito💗',
  'dayConfirmed', 'Muchas gracias😊💞'
),
first_visit_protocol = $protocolo$
En una PRIMERA VISITA (el paciente no está dado de alta), antes de dar hora:
- Pregunta la edad del niño o de la niña. Sólo se atiende a bebés y niños de 0 a 4 años (incluidos). Si es mayor, explícalo con amabilidad y no des cita.
- Pide el nombre y los apellidos del niño, su fecha de nacimiento y el nombre del titular del teléfono, para guardar el contacto.
- Pregunta si son gemelos o mellizos. Si es así, cada niño va en una hora distinta pero seguidas, salvo que sólo quieran cita para uno o prefieran horarios distintos.
- Pregunta si el niño tiene alguna enfermedad importante, si viene de un ingreso, o si tiene TDAH, autismo u otra condición parecida. En ese caso NO des cita: pasa la conversación a una persona del equipo.
- Si preguntan por el ayuno, la duración, si duele o el aparcamiento, contesta: 2 horas de ayuno (agua a sorbitos sí), 30-40 minutos, no duele aunque resulte incómodo, se aparca en la puerta sin parquímetro. Si no lo preguntan, no lo cuentes antes de reservar: va en la confirmación.
$protocolo$,
updated_at = now()
WHERE message_scripts IS NULL;
