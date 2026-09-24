-- Se retiran los retos recomendados del entrenamiento.
--
-- La 0039 añadió `agent_lessons.quest_id` para marcar de qué ajuste recomendado
-- salía una enseñanza y no volver a ofrecerlo. El panel de retos se quitó: la
-- clínica quiere la conversación, no un tablero de niveles al lado.
--
-- Las enseñanzas que se hubieran aplicado desde un reto se quedan: son
-- instrucciones válidas para el asistente. Lo único que desaparece es la marca
-- de dónde salieron, que ya no lee nadie.

DROP INDEX IF EXISTS agent_lessons_tenant_quest_uidx;

ALTER TABLE agent_lessons
  DROP COLUMN IF EXISTS quest_id;
