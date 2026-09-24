-- Entrenamiento: de qué reto salió una enseñanza.
--
-- La sección de entrenamiento recomienda ajustes concretos ("pregunta el nombre
-- al empezar", "no prometas resultados") y se aplican con un clic. Sin marcar
-- cuál se aplicó, el mismo consejo volvía a salir recomendado al día siguiente
-- aunque el asistente ya lo supiera.
--
-- El único parcial impide además que el mismo reto entre dos veces en la misma
-- clínica: dos personas del equipo pulsando a la vez dejaban la enseñanza
-- duplicada en el prompt.

ALTER TABLE agent_lessons
  ADD COLUMN IF NOT EXISTS quest_id text;

CREATE UNIQUE INDEX IF NOT EXISTS agent_lessons_tenant_quest_uidx
  ON agent_lessons (tenant_id, quest_id)
  WHERE quest_id IS NOT NULL;

COMMENT ON COLUMN agent_lessons.quest_id IS
  'Id del reto recomendado del que salió esta enseñanza. NULL = la propuso el entrenador o la escribió alguien a mano.';
