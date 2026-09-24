-- El entrenamiento también propone cambios en los DATOS de la clínica.
--
-- Enseñarle al asistente cómo responder no arregla un precio desactualizado.
-- Hasta aquí el entrenador contestaba "eso se cambia en Registros →
-- Tratamientos", que es mandar a la clínica a otra pantalla a hacer a mano lo
-- que acaba de explicar con palabras. Ahora lo propone con el antes y el
-- después, y se aplica con un clic sobre las tablas de siempre (`treatments`,
-- `faqs`, `clinic_settings`): no hay copia de los datos en ningún sitio.
--
-- Va en una columna aparte de `proposals` porque son dos cosas distintas: una
-- enseñanza entra en el prompt del asistente, un cambio de datos entra en la
-- ficha de la clínica y lo ve también el panel.

ALTER TABLE agent_training_messages
  ADD COLUMN IF NOT EXISTS data_changes jsonb;

COMMENT ON COLUMN agent_training_messages.data_changes IS
  'Cambios de datos (tratamientos, FAQs, ficha de la clínica) propuestos en ese turno, con su marca de aplicados.';
