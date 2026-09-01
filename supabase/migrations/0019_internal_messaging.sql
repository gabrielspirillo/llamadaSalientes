-- ─────────────────────────────────────────────────────────────────────────────
-- Módulo Mensajes (mensajería interna del equipo). Core, sin gate de
-- enabled_modules — igual que Tareas.
--
-- Por qué existe: hoy el equipo de la clínica coordina por un grupo de WhatsApp
-- personal. Ahí se pierde el contexto (nadie sabe de qué paciente se hablaba),
-- se pierden los acuerdos ("llamalo vos" → nadie llama) y los datos de paciente
-- terminan en móviles personales. Este módulo mete esa conversación adentro del
-- panel, con contexto tipado y con un puente de ida y vuelta a Tareas.
--
-- Tiempo real: SSE multiplexado por usuario (una conexión por persona, no una
-- por canal) + Redis pub/sub con fan-out en la escritura. Ver
-- docs/05-mensajeria-interna.md §3.
--
-- Idempotencia: `dedupe_key` con índice único parcial por tenant, mismo criterio
-- que tasks. Los canales de contexto usan 'patient:<id>' / 'task:<id>' y las
-- tarjetas de evento del bot 'evt:<evento>:<entidad>'.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Enums ───────────────────────────────────────────────────────────────────
CREATE TYPE im_channel_kind AS ENUM (
  'PUBLIC',   -- canal abierto: cualquiera del tenant entra y lo ve en el directorio
  'PRIVATE',  -- por invitación
  'DM',       -- 1 a 1
  'GROUP',    -- 3 a 8 personas, sin nombre
  'CONTEXT'   -- hilo anclado a una entidad (paciente, tarea, llamada, hueco)
);

CREATE TYPE im_context_type AS ENUM (
  'PATIENT',
  'TASK',
  'CALL',
  'WA_CONVERSATION',
  'WAITLIST_ENTRY',
  'APPOINTMENT',
  'CAMPAIGN'
);

CREATE TYPE im_sender_kind AS ENUM ('USER', 'SYSTEM', 'BOT');

CREATE TYPE im_message_kind AS ENUM (
  'TEXT',      -- lo que escribe una persona
  'SYSTEM',    -- "Ana agregó a Lucía al canal"
  'EVENT',     -- tarjeta que emite el producto (llamada perdida, hueco liberado)
  'DECISION'   -- acuerdo del equipo: se fija y se puede exportar
);

CREATE TYPE im_member_role AS ENUM ('OWNER', 'MEMBER');

-- ─── Canales ─────────────────────────────────────────────────────────────────
CREATE TABLE im_channels (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind                 im_channel_kind NOT NULL,
  slug                 text,
  name                 text,
  topic                text,
  icon                 text,
  tone                 text NOT NULL DEFAULT 'grape',
  is_system            boolean NOT NULL DEFAULT false,
  context_type         im_context_type,
  context_id           text,
  context_label        text,
  dedupe_key           text,
  last_message_at      timestamptz,
  last_message_preview text,
  message_count        integer NOT NULL DEFAULT 0,
  archived_at          timestamptz,
  created_by_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX im_channels_tenant_slug_key   ON im_channels (tenant_id, slug) WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX im_channels_tenant_dedupe_key ON im_channels (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX im_channels_tenant_last_msg_idx ON im_channels (tenant_id, last_message_at DESC);
CREATE INDEX im_channels_context_idx         ON im_channels (tenant_id, context_type, context_id);

-- ─── Membresías ──────────────────────────────────────────────────────────────
-- unread_count y mention_count están desnormalizados a propósito: el sidebar se
-- renderiza en CADA navegación (layout.tsx es server component), y un count(*)
-- por canal ahí sería inaceptable.
CREATE TABLE im_channel_members (
  channel_id           uuid NOT NULL REFERENCES im_channels(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role                 im_member_role NOT NULL DEFAULT 'MEMBER',
  last_read_at         timestamptz NOT NULL DEFAULT now(),
  last_read_message_id uuid,
  unread_count         integer NOT NULL DEFAULT 0,
  mention_count        integer NOT NULL DEFAULT 0,
  muted_until          timestamptz,
  pinned               boolean NOT NULL DEFAULT false,
  joined_at            timestamptz NOT NULL DEFAULT now(),
  left_at              timestamptz,
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX im_members_user_idx   ON im_channel_members (user_id, tenant_id) WHERE left_at IS NULL;
CREATE INDEX im_members_unread_idx ON im_channel_members (user_id) WHERE unread_count > 0;
CREATE INDEX im_members_tenant_idx ON im_channel_members (tenant_id);

-- ─── Mensajes ────────────────────────────────────────────────────────────────
CREATE TABLE im_messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_id         uuid NOT NULL REFERENCES im_channels(id) ON DELETE CASCADE,
  kind               im_message_kind NOT NULL DEFAULT 'TEXT',
  sender_kind        im_sender_kind NOT NULL DEFAULT 'USER',
  sender_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  body               text NOT NULL DEFAULT '',
  parent_id          uuid REFERENCES im_messages(id) ON DELETE CASCADE,
  reply_count        integer NOT NULL DEFAULT 0,
  -- Contexto congelado al publicar: renderizar la tarjeta no debe hacer joins.
  -- Que el snapshot envejezca es correcto: el mensaje describe lo que pasó
  -- ENTONCES.
  context_type       im_context_type,
  context_id         text,
  context_payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  attachments        jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions            jsonb NOT NULL DEFAULT '[]'::jsonb,
  event_key          text,
  mentions           uuid[] NOT NULL DEFAULT '{}',
  mentions_everyone  boolean NOT NULL DEFAULT false,
  client_nonce       text,
  dedupe_key         text,
  edited_at          timestamptz,
  deleted_at         timestamptz,
  deleted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Paginación keyset: (created_at DESC, id DESC). Nada de OFFSET.
CREATE INDEX im_messages_channel_created_idx ON im_messages (channel_id, created_at DESC, id DESC);
CREATE INDEX im_messages_parent_idx          ON im_messages (parent_id, created_at) WHERE parent_id IS NOT NULL;
CREATE INDEX im_messages_mentions_idx        ON im_messages USING gin (mentions);
CREATE INDEX im_messages_context_idx         ON im_messages (tenant_id, context_type, context_id) WHERE context_type IS NOT NULL;
CREATE INDEX im_messages_tenant_created_idx  ON im_messages (tenant_id, created_at DESC);
CREATE UNIQUE INDEX im_messages_nonce_key    ON im_messages (channel_id, client_nonce) WHERE client_nonce IS NOT NULL;
CREATE UNIQUE INDEX im_messages_dedupe_key   ON im_messages (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX im_messages_fts_idx             ON im_messages USING gin (to_tsvector('spanish', body));

-- ─── Reacciones ──────────────────────────────────────────────────────────────
CREATE TABLE im_message_reactions (
  message_id uuid NOT NULL REFERENCES im_messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX im_reactions_message_idx ON im_message_reactions (message_id);

-- ─── Menciones (bandeja "para mí") ───────────────────────────────────────────
CREATE TABLE im_mentions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id   uuid NOT NULL REFERENCES im_messages(id) ON DELETE CASCADE,
  channel_id   uuid NOT NULL REFERENCES im_channels(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at      timestamptz,
  resolved_at  timestamptz,
  escalated_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX im_mentions_inbox_idx ON im_mentions (user_id, read_at, created_at DESC);
CREATE UNIQUE INDEX im_mentions_msg_user_key ON im_mentions (message_id, user_id);

-- ─── Guardados / fijados ─────────────────────────────────────────────────────
CREATE TABLE im_saved_messages (
  message_id uuid NOT NULL REFERENCES im_messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE im_pins (
  channel_id        uuid NOT NULL REFERENCES im_channels(id) ON DELETE CASCADE,
  message_id        uuid NOT NULL REFERENCES im_messages(id) ON DELETE CASCADE,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pinned_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, message_id)
);

-- ─── Preferencias por usuario ────────────────────────────────────────────────
CREATE TABLE im_user_settings (
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sound        boolean NOT NULL DEFAULT true,
  desktop_push boolean NOT NULL DEFAULT true,
  dnd_from     text,
  dnd_to       text,
  escalate_mentions_after_minutes integer NOT NULL DEFAULT 0,
  status_emoji text,
  status_text  text,
  status_until timestamptz,
  retention_months integer NOT NULL DEFAULT 24,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

-- ─── Puente con Tareas ───────────────────────────────────────────────────────
-- Cierra el círculo: un mensaje se convierte en tarea y la tarea sabe de dónde
-- vino; el hilo de la tarea reemplaza a la caja de comentarios del panel.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS im_channel_id uuid REFERENCES im_channels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS im_message_id uuid REFERENCES im_messages(id) ON DELETE SET NULL;
