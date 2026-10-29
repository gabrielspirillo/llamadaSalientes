-- Respinens: el asistente es administración, no personal sanitario.
-- * Una consulta médica o "quiero hablar con Raquel" → se le pasa a Raquel con
--   este mensaje (y el aviso sale en el panel, sección "Requiere atención").
-- * El protocolo de primera visita deja de preguntar por enfermedades,
--   ingresos o TDAH: sólo pide nombre y apellidos del peque, fecha de
--   nacimiento y nombre de quien escribe.

UPDATE tenant_care_profile
SET message_scripts = message_scripts || jsonb_build_object(
      'staffName', 'Raquel',
      'handoff', $h$Te pongo en contacto con Raquel 😊 En cuanto pueda te escribe.

El resto de dudas que tengas os las resolverá en la propia cita ✨$h$
    ),
    first_visit_protocol = $p$
En una PRIMERA VISITA pide SÓLO lo que no esté ya en la ficha:
- Nombre y apellidos del peque.
- Su fecha de nacimiento (sólo se atiende de 0 a 4 años; la edad sale de la fecha. Si es mayor, explícalo con amabilidad y no des cita).
- El nombre de quien escribe.
Si son gemelos o mellizos, cada peque va en una hora distinta pero seguidas, salvo que pidan otra cosa.
No hagas ninguna pregunta médica. Si te cuentan algo médico (una enfermedad, un ingreso…), no preguntes más: pásalo con request_handoff.
$p$,
    updated_at = now()
WHERE message_scripts ? 'dayOf';
