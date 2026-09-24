-- Entrenar al asistente: la clínica le enseña conversando, no editando un prompt.
--
-- Hasta aquí lo que el asistente sabía salía de tres sitios: el catálogo de
-- tratamientos, las FAQs y el campo `persona` de whatsapp_agent_settings (un
-- textarea suelto que nadie de una clínica iba a escribir bien). Cuando el
-- asistente contestaba mal a un lead, la clínica no tenía forma de corregirlo:
-- nos lo contaba por teléfono y alguien tocaba el prompt a mano.
--
-- Ahora la clínica habla con un entrenador (otro LLM), le cuenta en su idioma
-- qué quiere que cambie, y el entrenador propone ENSEÑANZAS concretas que la
-- clínica aprueba de a una. Cada enseñanza aprobada entra en el system prompt
-- del asistente de WhatsApp en la siguiente conversación.
--
-- Una enseñanza NO anula las reglas duras del agente ni los datos oficiales
-- (precios, horarios, agenda): afina el comportamiento. Eso se impone en el
-- prompt, donde la sección va marcada como aditiva.

CREATE TABLE IF NOT EXISTS agent_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- ANSWER  = qué responder ante una pregunta concreta
  -- RULE    = cómo actuar en una situación (cuándo derivar, qué ofrecer…)
  -- STYLE   = tono, trato, longitud
  -- BOUNDARY= lo que NO debe hacer ni decir
  kind text NOT NULL CHECK (kind IN ('ANSWER', 'RULE', 'STYLE', 'BOUNDARY')),
  title text NOT NULL,
  -- Cuándo aplica, en lenguaje natural. NULL = siempre.
  situation text,
  -- La instrucción tal cual entra en el prompt del asistente.
  instruction text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED')),
  -- COACH = salió de una conversación con el entrenador. MANUAL = la escribió
  -- alguien a mano en la pestaña "Lo aprendido".
  source text NOT NULL DEFAULT 'COACH' CHECK (source IN ('COACH', 'MANUAL')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- El asistente sólo lee las activas de su clínica: el índice lidera por tenant
-- y filtra por estado, que es exactamente la query del prompt.
CREATE INDEX IF NOT EXISTS agent_lessons_tenant_status_idx
  ON agent_lessons (tenant_id, status, created_at DESC);

COMMENT ON TABLE agent_lessons IS
  'Lo que la clínica le enseñó a su asistente de WhatsApp. Aditivo: nunca anula las reglas duras ni los datos oficiales.';

-- La conversación con el entrenador se guarda para que no se pierda al
-- recargar: una clínica entrena en varios ratos, no de una sentada.
CREATE TABLE IF NOT EXISTS agent_training_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  -- Propuestas que acompañaron a ese turno del entrenador, con la marca de si
  -- ya se aplicaron. Sin esto, al recargar la página las tarjetas volvían a
  -- salir como pendientes y se aplicaba la misma enseñanza dos veces.
  proposals jsonb,
  author_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_training_messages_tenant_idx
  ON agent_training_messages (tenant_id, created_at);

COMMENT ON TABLE agent_training_messages IS
  'Historial de la conversación de entrenamiento entre la clínica y el entrenador del asistente.';
