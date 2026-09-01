-- Índices de rendimiento derivados de la auditoría de la capa de datos.
--
-- Se usan CREATE INDEX (no CONCURRENTLY) a propósito: el runner de
-- lib/db/migrate.ts envuelve cada archivo en una transacción, y CONCURRENTLY
-- no puede correr dentro de un bloque transaccional. Con el volumen actual el
-- lock de escritura dura segundos. Si alguna tabla crece a millones de filas,
-- crear el índice a mano con CONCURRENTLY por psql ANTES de desplegar: el
-- IF NOT EXISTS hace que esta migración pase de largo.

-- ─── calls ───────────────────────────────────────────────────────────────────
-- Todo el producto ordena y filtra las llamadas por COALESCE(started_at,
-- created_at) y ningún índice cubría esa expresión: calls_tenant_started_idx
-- es sobre la columna pelada, así que listCalls, el dashboard y los analytics
-- inbound hacían seq-scan + sort del historial completo del tenant.
CREATE INDEX IF NOT EXISTS calls_tenant_occurred_idx
  ON calls (tenant_id, (COALESCE(started_at, created_at)) DESC);

-- getUpcomingAppointments fija intent='agendar' antes de ordenar por fecha.
CREATE INDEX IF NOT EXISTS calls_tenant_intent_occurred_idx
  ON calls (tenant_id, intent, (COALESCE(started_at, created_at)) DESC)
  WHERE intent IS NOT NULL;

-- countCallsPendingIntent: la cola de llamadas con transcript sin clasificar.
CREATE INDEX IF NOT EXISTS calls_pending_intent_idx
  ON calls (tenant_id)
  WHERE transcript_enc IS NOT NULL AND intent IS NULL;

-- countCallsMissingMetadata y /api/admin/backfill-call-metadata barren esto.
CREATE INDEX IF NOT EXISTS calls_missing_metadata_idx
  ON calls (tenant_id)
  WHERE started_at IS NULL OR duration_seconds IS NULL;

-- ─── whatsapp ────────────────────────────────────────────────────────────────
-- El preview del inbox y el hilo de la conversación filtran por
-- conversation_id solo; los índices existentes lideran por tenant_id y no
-- servían.
CREATE INDEX IF NOT EXISTS whatsapp_messages_conv_created_idx
  ON whatsapp_messages (conversation_id, created_at DESC);

-- KPIs de WhatsApp: rango puro sobre created_at.
CREATE INDEX IF NOT EXISTS whatsapp_messages_tenant_created_idx
  ON whatsapp_messages (tenant_id, created_at DESC);

-- Orden del inbox: coalesce(last_msg_at, created_at) DESC.
CREATE INDEX IF NOT EXISTS whatsapp_conversations_tenant_activity_idx
  ON whatsapp_conversations (tenant_id, (COALESCE(last_msg_at, created_at)) DESC);

-- getOrCreateOpenConversation, en el camino caliente de cada mensaje entrante.
CREATE INDEX IF NOT EXISTS whatsapp_conversations_open_idx
  ON whatsapp_conversations (tenant_id, contact_id, channel)
  WHERE status <> 'CLOSED';

-- ─── appointments_cache ──────────────────────────────────────────────────────
-- Las series de no-show filtran por end_time; el único índice era por start_time.
CREATE INDEX IF NOT EXISTS appointments_cache_tenant_end_idx
  ON appointments_cache (tenant_id, end_time);

-- Citas del contacto en el panel lateral del inbox. La PK es
-- (tenant_id, ghl_appointment_id): no sirve para buscar por contacto.
CREATE INDEX IF NOT EXISTS appointments_cache_tenant_contact_idx
  ON appointments_cache (tenant_id, contact_id, start_time)
  WHERE contact_id IS NOT NULL;

-- ─── tasks ───────────────────────────────────────────────────────────────────
-- loadBoardTasks. El índice existente no es parcial y arrastraba el histórico
-- archivado que el tablero descarta después.
CREATE INDEX IF NOT EXISTS tasks_board_idx
  ON tasks (tenant_id, status, board_position)
  WHERE archived_at IS NULL;

-- Rango puro sobre created_at (stats y analytics de mensajería).
CREATE INDEX IF NOT EXISTS tasks_tenant_created_idx
  ON tasks (tenant_id, created_at DESC);

-- loadTaskStats recorría todas las tareas DONE del tenant desde el inicio.
CREATE INDEX IF NOT EXISTS tasks_tenant_done_completed_idx
  ON tasks (tenant_id, completed_at DESC)
  WHERE status = 'DONE';

-- Historial de rutinas, ordenado por archived_at DESC. No tenía índice.
CREATE INDEX IF NOT EXISTS tasks_tenant_archived_idx
  ON tasks (tenant_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;

-- Tareas generadas por cada plantilla + la FK que un DELETE tiene que
-- verificar.
CREATE INDEX IF NOT EXISTS tasks_tenant_template_created_idx
  ON tasks (tenant_id, template_id, created_at)
  WHERE template_id IS NOT NULL;

-- El NOT EXISTS por evento de los analytics de mensajería, y la FK
-- tasks.im_message_id -> im_messages, que no tenía índice.
CREATE INDEX IF NOT EXISTS tasks_im_message_idx
  ON tasks (im_message_id)
  WHERE im_message_id IS NOT NULL;

-- ─── mensajería interna ──────────────────────────────────────────────────────
-- loadThread pide sólo mensajes raíz; el índice existente no es parcial y
-- obligaba a leer y descartar las respuestas de hilo en el heap.
CREATE INDEX IF NOT EXISTS im_messages_channel_root_idx
  ON im_messages (channel_id, created_at DESC, id DESC)
  WHERE parent_id IS NULL;

-- Las tarjetas de evento son una fracción de im_messages: el parcial las aísla.
CREATE INDEX IF NOT EXISTS im_messages_tenant_event_idx
  ON im_messages (tenant_id, created_at DESC)
  WHERE kind = 'EVENT' AND deleted_at IS NULL;

-- El join lateral de queryReactionTime: el índice por canal no conoce
-- sender_kind ni deleted_at.
CREATE INDEX IF NOT EXISTS im_messages_channel_human_idx
  ON im_messages (channel_id, created_at)
  WHERE sender_kind = 'USER' AND deleted_at IS NULL;

-- loadMentions filtra (tenant_id, user_id) y ordena por created_at DESC;
-- im_mentions_inbox_idx mete read_at en el medio y rompe el orden.
CREATE INDEX IF NOT EXISTS im_mentions_user_created_idx
  ON im_mentions (tenant_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS im_mentions_open_idx
  ON im_mentions (tenant_id, user_id, created_at DESC)
  WHERE resolved_at IS NULL;

-- hydrateMessages busca los guardados del usuario para una página de mensajes;
-- la PK lidera por message_id y obligaba a un sondeo por id.
CREATE INDEX IF NOT EXISTS im_saved_user_message_idx
  ON im_saved_messages (user_id, message_id);

-- ─── lead_memory ─────────────────────────────────────────────────────────────
-- Declarado en schema.ts pero creado sólo en la migración que vivía en el
-- directorio huérfano que el runner nunca leía.
CREATE INDEX IF NOT EXISTS lead_memory_tenant_ghl_idx
  ON lead_memory (tenant_id, ghl_contact_id)
  WHERE ghl_contact_id IS NOT NULL;
