# Mensajería interna del equipo — investigación y plan de implementación

> Parte de la [Documentación para Desarrolladores](./README.md). Ver también: [Arquitectura](./01-arquitectura.md) · [Setup local](./02-setup.md) · [Referencia de API](./03-api-referencia.md) · [Deployment](./04-deployment.md).

**Estado**: investigación cerrada, sin código escrito. Este documento es el plan que hay que ejecutar.
**Nombre del módulo**: `Mensajes` (ruta `/dashboard/messages`, prefijo de tablas `im_`, de *internal messaging*).

---

## 1. Por qué, y qué se gana

Hoy el equipo de una clínica coordina por un grupo de WhatsApp personal. Eso produce cuatro pérdidas medibles, y las cuatro las puede cerrar un chat interno que viva **dentro** del panel:

| Pérdida | Cómo se ve hoy | Qué la cierra |
|---|---|---|
| Contexto que se evapora | "¿de qué paciente hablábamos?" — el hilo de WhatsApp no sabe qué es una cita | Cada mensaje puede llevar **contexto tipado** (paciente, llamada, tarea, hueco de waitlist) y se renderiza como tarjeta viva |
| Acuerdos que no se ejecutan | "llamalo vos" → nadie llama | Un mensaje se convierte en **Tarea** con un clic, con paciente y vencimiento ya cargados |
| Datos de paciente en móviles personales | nombre + teléfono + tratamiento en WhatsApp personal | Conversación dentro del tenant, con auditoría y retención — postura RGPD defendible |
| Nadie sabe si el equipo va bien | la carga se percibe, no se mide | Tiempo de respuesta interno, menciones sin atender y traspasos por persona **en Analytics** |

El objetivo declarado por el usuario —"que sean más ejecutivos y puedan atender más pacientes"— se traduce en una métrica concreta: **tiempo entre que aparece un evento accionable (llamada perdida, hueco liberado, handoff de WhatsApp) y que alguien lo toma**. Todo el diseño de abajo optimiza ese número.

---

## 2. Inventario: qué ya existe y se reutiliza

No hay que inventar infraestructura. El repo ya tiene todas las piezas:

| Pieza | Dónde | Qué aporta al módulo |
|---|---|---|
| **SSE + Redis pub/sub** | `app/api/whatsapp/conversations/[id]/stream/route.ts` + `lib/whatsapp/realtime/{events,publisher}.ts` | El patrón de tiempo real ya está probado en producción detrás de Traefik (heartbeat 15 s, `X-Accel-Buffering: no`, reconexión de `EventSource`). Se generaliza. |
| **Consumidor SSE en cliente** | `_components/messages-stream.tsx` | Dedupe por id, `stickToBottom`, burbujas animadas, typing dots. Es el 60 % de la UI del hilo. |
| **Multi-tenant + roles** | `lib/tenant.ts`, `lib/tasks/auth.ts`, `lib/tenant-members.ts` | `getCurrentTenant()`, `requireTaskRole()` y el sync de miembros contra Clerk. El chat clona el gate con `requireMessagingRole()`. |
| **BullMQ + worker** | `lib/queue/*`, `worker/index.ts` | Digests, escalado de menciones y limpieza de retención salen como jobs; los crons repetibles con `jobId` fijo ya son idempotentes. |
| **MinIO / S3** | `lib/storage/media.ts` (`mediaUpload`, path-style) | Adjuntos. Bucket nuevo `internal-files` (privado, URLs firmadas), o prefijo dentro de `whatsapp-media`. |
| **Módulo Tareas** | `lib/tasks/{service,hooks,automation,queries}.ts` | `createTask()`, `logActivity()` y los 10 triggers de automatización. El chat engancha ahí sin tocar la lógica. |
| **Sistema Aurora** | `app/globals.css` + `components/ui/*` | ~24 keyframes, `Reveal`/`Stagger`/`Spotlight`, `AvatarStack`, `Equalizer`, `Card`/`CardTopbar`. La UI se arma con primitivas existentes, sin dependencias nuevas. |
| **Badge en sidebar** | `components/dashboard/sidebar.tsx` (`tasksBadge`) | El contador de no leídos usa exactamente el mismo prop y la misma píldora violeta. |
| **Cmd-K** | `components/dashboard/topbar.tsx` (`SearchPalette`) | Se extiende con hits de tipo `channel` / `person` / `message`. |
| **Auditoría** | `lib/audit.ts`, tabla `audit_logs` | Borrados y cambios de permisos de canal. |

**Dependencias nuevas: cero.** Ni socket.io, ni Pusher, ni Ably, ni framer-motion.

---

## 3. Decisiones de arquitectura

### 3.1 Transporte de tiempo real: SSE multiplexado + Redis pub/sub

**Decisión: una sola conexión SSE por usuario** (`GET /api/messages/stream`), suscrita a su canal personal de Redis `im:user:<userId>`. El fan-out se hace **en la escritura**: al insertar un mensaje se publica una copia a cada miembro del canal.

Por qué así y no de otra forma:

| Alternativa | Por qué se descarta |
|---|---|
| Una SSE por conversación (como hace hoy WhatsApp inbox) | Con 12 canales abiertos son 12 conexiones y 12 clientes ioredis por usuario. HTTP/1.1 corta en ~6 por origen. Insostenible. |
| WebSockets (socket.io / ws) | Requiere proceso aparte o custom server (rompe el `next build` standalone), config de upgrade en Traefik y sticky sessions en Swarm. Coste alto para ganar un canal bidireccional que no necesitamos: el cliente escribe por `fetch` POST, que ya es fiable y tipado. |
| Postgres `LISTEN`/`NOTIFY` | Payload máximo 8 KB, una conexión dedicada por listener, y no sobrevive bien al pooler. |
| Polling cada 3 s | Mata la sensación de inmediatez y multiplica queries por usuario conectado. |
| SaaS (Pusher/Ably) | Contradice la regla de oro de `CLAUDE.md`: nada de SaaS nuevo, todo self-hosted en Dokploy. |

**Fan-out en escritura vs. en lectura.** Publicar a `im:channel:<id>` obligaría a cada SSE a suscribirse a N canales dinámicamente (y a re-suscribirse cuando alguien entra a un canal). Publicar a `im:user:<id>` deja la conexión con **una sola suscripción fija** durante toda la sesión. El coste es un `PUBLISH` por miembro: con canales de ≤ 30 personas es despreciable, y se resuelve con `pipeline()`.

### 3.2 Hub de suscripciones compartido (mejora que también arregla WhatsApp)

El stream de WhatsApp abre **un cliente ioredis nuevo por conexión SSE**. Con el chat interno eso escala mal (cada usuario logueado = 1 conexión Redis permanente). La propuesta es `lib/realtime/hub.ts`: **un único subscriber por proceso Node**, con un `Map<channel, Set<controller>>` y refcount.

```ts
// lib/realtime/hub.ts — boceto
type Sink = (payload: string) => void;

const subs = new Map<string, Set<Sink>>();
let sub: Redis | null = null;

function ensureSubscriber(): Redis {
  if (sub) return sub;
  sub = new IORedis(env.REDIS_URL!, { maxRetriesPerRequest: null, retryStrategy: (t) => Math.min(t * 200, 5000) });
  sub.on('message', (ch, payload) => {
    for (const sink of subs.get(ch) ?? []) { try { sink(payload); } catch { /* sink muerto: lo limpia su propio unsubscribe */ } }
  });
  // Reconexión: Redis pierde las suscripciones al reconectar, hay que rehacerlas.
  sub.on('ready', () => { const chs = [...subs.keys()]; if (chs.length) sub!.subscribe(...chs).catch(() => undefined); });
  return sub;
}

export async function subscribe(channel: string, sink: Sink): Promise<() => void> {
  const s = ensureSubscriber();
  let set = subs.get(channel);
  if (!set) { set = new Set(); subs.set(channel, set); await s.subscribe(channel); }
  set.add(sink);
  return () => {
    set!.delete(sink);
    if (set!.size === 0) { subs.delete(channel); s.unsubscribe(channel).catch(() => undefined); }
  };
}
```

Beneficio directo: de *N usuarios conectados* conexiones Redis se pasa a *1 por réplica web*. Migrar después el stream de WhatsApp a este hub es un refactor de ~30 líneas y elimina una fuente conocida de fuga de conexiones.

> ⚠️ **Ojo con las réplicas.** Con varias réplicas de `cliniq-web`, cada una tiene su propio hub y su propia suscripción — Redis pub/sub hace broadcast a todas, así que funciona sin sticky sessions. Lo que **no** funciona es guardar presencia en memoria del proceso: va a Redis (§3.3).

### 3.3 Estado efímero en Redis, estado durable en Postgres

| Estado | Dónde | Por qué |
|---|---|---|
| Mensajes, canales, miembros, reacciones, lecturas | Postgres | Es el registro; se consulta, se audita y se exporta |
| **Typing** (`está escribiendo…`) | Redis `SETEX im:typing:<ch>:<user> 6` + `PUBLISH` | No tiene ningún valor a los 6 segundos. Escribirlo en Postgres sería un `UPDATE` por pulsación |
| **Presencia** (en línea / ausente) | Redis `SETEX im:presence:<tenant>:<user> 45` con heartbeat cada 20 s desde el SSE | Idem. Se lee con un `MGET` de los miembros |
| **Contador de no leídos** | Postgres (`last_read_at` en membresía) + cache en Redis | La verdad vive en la membresía; el cache evita un `count(*)` por render del sidebar |

---

## 4. Modelo de datos

Migración nueva: `supabase/migrations/0019_internal_messaging.sql`.

> 🚨 **Colisión de numeración detectada.** Hay **dos** carpetas de migraciones con numeraciones que se pisan: `supabase/migrations/` (raíz, llega a `0018_tasks.sql`) y `apps/web/supabase/migrations/` (llega a `0020_rag_embeddings.sql`, con un `0018_lead_memory.sql` distinto). `CLAUDE.md` apunta a la raíz y Tareas —lo último construido— se agregó ahí. **Recomendación**: crear esta migración en la raíz como `0019_internal_messaging.sql` y, en un chore aparte, renumerar o consolidar `apps/web/supabase/migrations/` para que no vuelva a pasar.

### 4.1 Enums

```sql
CREATE TYPE im_channel_kind AS ENUM (
  'PUBLIC',   -- canal abierto: cualquiera del tenant entra y lo ve en el directorio
  'PRIVATE',  -- por invitación
  'DM',       -- 1 a 1
  'GROUP',    -- DM de 3 a 8 personas, sin nombre
  'CONTEXT'   -- hilo anclado a una entidad (paciente, tarea, llamada, hueco)
);

CREATE TYPE im_context_type AS ENUM (
  'PATIENT', 'TASK', 'CALL', 'WA_CONVERSATION', 'WAITLIST_ENTRY', 'APPOINTMENT', 'CAMPAIGN'
);

CREATE TYPE im_sender_kind AS ENUM ('USER', 'SYSTEM', 'BOT');

CREATE TYPE im_message_kind AS ENUM (
  'TEXT',      -- lo que escribe una persona
  'SYSTEM',    -- "Ana agregó a Lucía al canal"
  'EVENT',     -- tarjeta que emite el producto (llamada perdida, hueco liberado)
  'DECISION'   -- mensaje marcado como acuerdo del equipo: se fija y se puede exportar
);

CREATE TYPE im_member_role AS ENUM ('OWNER', 'MEMBER');
```

### 4.2 Tablas

```sql
-- ─── Canales ────────────────────────────────────────────────────────────────
CREATE TABLE im_channels (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind              im_channel_kind NOT NULL,
  slug              text,                       -- 'general', 'agenda' — solo PUBLIC/PRIVATE
  name              text,                       -- NULL en DM: el nombre es la otra persona
  topic             text,
  icon              text,                       -- emoji o clave de lucide
  tone              text NOT NULL DEFAULT 'grape',  -- mismo vocabulario de color que el sidebar
  is_system         boolean NOT NULL DEFAULT false, -- canales sembrados, no borrables
  -- Anclaje contextual (kind = 'CONTEXT')
  context_type      im_context_type,
  context_id        text,                       -- uuid o id externo (GHL) según el tipo
  context_label     text,                       -- "María López · Implante" cacheado para la lista
  -- Clave de deduplicación: garantiza un solo hilo por entidad
  dedupe_key        text,
  last_message_at   timestamptz,
  last_message_preview text,
  message_count     integer NOT NULL DEFAULT 0,
  archived_at       timestamptz,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX im_channels_tenant_slug_key   ON im_channels (tenant_id, slug) WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX im_channels_tenant_dedupe_key ON im_channels (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX im_channels_tenant_last_msg_idx ON im_channels (tenant_id, last_message_at DESC);
CREATE INDEX im_channels_context_idx         ON im_channels (tenant_id, context_type, context_id);

-- ─── Membresías ─────────────────────────────────────────────────────────────
CREATE TABLE im_channel_members (
  channel_id        uuid NOT NULL REFERENCES im_channels(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role              im_member_role NOT NULL DEFAULT 'MEMBER',
  last_read_at      timestamptz NOT NULL DEFAULT now(),
  last_read_message_id uuid,
  unread_count      integer NOT NULL DEFAULT 0,   -- desnormalizado: evita count(*) por render
  mention_count     integer NOT NULL DEFAULT 0,
  muted_until       timestamptz,
  pinned            boolean NOT NULL DEFAULT false, -- fijado arriba en el rail del usuario
  joined_at         timestamptz NOT NULL DEFAULT now(),
  left_at           timestamptz,
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX im_members_user_idx    ON im_channel_members (user_id, tenant_id) WHERE left_at IS NULL;
CREATE INDEX im_members_unread_idx  ON im_channel_members (user_id) WHERE unread_count > 0;

-- ─── Mensajes ───────────────────────────────────────────────────────────────
CREATE TABLE im_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_id        uuid NOT NULL REFERENCES im_channels(id) ON DELETE CASCADE,
  kind              im_message_kind NOT NULL DEFAULT 'TEXT',
  sender_kind       im_sender_kind NOT NULL DEFAULT 'USER',
  sender_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,  -- NULL si SYSTEM/BOT
  body              text NOT NULL DEFAULT '',                       -- markdown acotado
  -- Hilos: respuesta dentro del canal, sin crear canal nuevo
  parent_id         uuid REFERENCES im_messages(id) ON DELETE CASCADE,
  reply_count       integer NOT NULL DEFAULT 0,
  -- Contexto y adjuntos
  context_type      im_context_type,
  context_id        text,
  context_payload   jsonb NOT NULL DEFAULT '{}'::jsonb,  -- snapshot para render sin joins
  attachments       jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{key,url,mime,size,name,w,h}]
  mentions          uuid[] NOT NULL DEFAULT '{}',        -- users.id mencionados
  mentions_everyone boolean NOT NULL DEFAULT false,
  -- Idempotencia del envío optimista (mismo patrón que whatsapp_messages)
  client_nonce      text,
  edited_at         timestamptz,
  deleted_at        timestamptz,                          -- soft delete: queda la lápida
  deleted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Paginación keyset: (created_at DESC, id DESC) desde el final del canal
CREATE INDEX im_messages_channel_created_idx ON im_messages (channel_id, created_at DESC, id DESC);
CREATE INDEX im_messages_parent_idx          ON im_messages (parent_id, created_at) WHERE parent_id IS NOT NULL;
CREATE INDEX im_messages_mentions_idx        ON im_messages USING gin (mentions);
CREATE INDEX im_messages_context_idx         ON im_messages (tenant_id, context_type, context_id) WHERE context_type IS NOT NULL;
CREATE UNIQUE INDEX im_messages_nonce_key    ON im_messages (channel_id, client_nonce) WHERE client_nonce IS NOT NULL;
-- Búsqueda full-text en español (mismo idioma que la UI)
CREATE INDEX im_messages_fts_idx ON im_messages USING gin (to_tsvector('spanish', body));

-- ─── Reacciones ─────────────────────────────────────────────────────────────
CREATE TABLE im_message_reactions (
  message_id uuid NOT NULL REFERENCES im_messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

-- ─── Menciones (bandeja "para mí") ──────────────────────────────────────────
CREATE TABLE im_mentions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id  uuid NOT NULL REFERENCES im_messages(id) ON DELETE CASCADE,
  channel_id  uuid NOT NULL REFERENCES im_channels(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at     timestamptz,
  resolved_at timestamptz,   -- "ya lo atendí" sin tener que responder
  escalated_at timestamptz,  -- se avisó por otro canal (push/WhatsApp) por no leerse
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX im_mentions_inbox_idx ON im_mentions (user_id, read_at, created_at DESC);
CREATE UNIQUE INDEX im_mentions_msg_user_key ON im_mentions (message_id, user_id);

-- ─── Guardados / fijados ────────────────────────────────────────────────────
CREATE TABLE im_saved_messages (
  message_id uuid NOT NULL REFERENCES im_messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE im_pins (
  channel_id uuid NOT NULL REFERENCES im_channels(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES im_messages(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pinned_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, message_id)
);

-- ─── Preferencias por usuario ───────────────────────────────────────────────
CREATE TABLE im_user_settings (
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sound        boolean NOT NULL DEFAULT true,
  desktop_push boolean NOT NULL DEFAULT true,
  dnd_from     text,   -- 'HH:MM' en la timezone de la clínica
  dnd_to       text,
  escalate_mentions_after_minutes integer NOT NULL DEFAULT 0, -- 0 = no escalar
  status_emoji text,
  status_text  text,
  status_until timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
```

Además, una columna en `tasks` para cerrar el círculo con Tareas:

```sql
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS im_channel_id uuid REFERENCES im_channels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS im_message_id uuid REFERENCES im_messages(id) ON DELETE SET NULL;
```

### 4.3 Notas de diseño del modelo

- **`unread_count` desnormalizado.** El sidebar se renderiza en cada navegación (`layout.tsx` server component). Un `count(*)` sobre `im_messages` por canal y por render es inaceptable. Se incrementa en el mismo `UPDATE` del fan-out y se resetea al marcar leído. Un job nocturno puede reconciliarlo contra `last_read_at` por si se desincroniza.
- **`context_payload` como snapshot.** Renderizar la tarjeta de "llamada perdida de María" no debe hacer un join a `calls` + `patients_cache` por mensaje. Se congela el snapshot al publicar. Que el dato quede viejo es correcto: el mensaje describe lo que pasó *entonces*.
- **Soft delete.** `deleted_at` deja la lápida ("mensaje eliminado"). En un contexto con datos clínicos, un borrado duro rompe la trazabilidad; el borrado real lo hace el job de retención.
- **`client_nonce` con índice único parcial.** Copiado de `whatsapp_messages`: habilita envío optimista sin duplicados si el usuario reintenta o la red hipa.
- **Hilos sin tabla aparte.** `parent_id` autorreferencial + `reply_count`. Un canal por respuesta sería explosión de filas.
- **RLS**: igual que el resto del esquema, preparado pero no activado (fase 7 global). Todo el aislamiento por tenant es a nivel de query, con `tenant_id` en **todas** las tablas incluso donde sería derivable — misma decisión que ya tomaron `task_assignees` y `task_checklist_items`.

---

## 5. Capa de servicio

Módulo nuevo `lib/messaging/`, con la misma forma que `lib/tasks/`:

```
lib/messaging/
  auth.ts        requireMessagingRole(), canPostIn(), canManageChannel()
  types.ts       ChannelDTO, MessageDTO, MentionDTO (serializables server→client)
  events.ts      serializeMessage(), userChannel(), tenantChannel(), tipos de evento SSE
  publisher.ts   publishToMembers(), publishTyping(), publishPresence()
  service.ts     sendMessage(), editMessage(), deleteMessage(), react(), markRead()
  channels.ts    createChannel(), ensureContextChannel(), join/leave, archive
  queries.ts     loadRail(), loadThread(), loadMentions(), unreadSummary()
  mentions.ts    parseo de @menciones, resolución a users.id, alta en im_mentions
  bot.ts         postSystemEvent() — la API que usa el resto del producto
  seed.ts        canales por defecto en la primera visita (idempotente)
  search.ts      búsqueda FTS sobre im_messages
```

### 5.1 El corazón: `sendMessage`

```ts
// lib/messaging/service.ts — flujo, no implementación literal
export async function sendMessage(input: SendMessageInput): Promise<{ id: string }> {
  const mentioned = await resolveMentions(input.tenantId, input.body);   // @ana → users.id

  const row = await db.transaction(async (tx) => {
    const [msg] = await tx.insert(imMessages).values({ ...input, mentions: mentioned })
      .onConflictDoNothing({ target: [imMessages.channelId, imMessages.clientNonce] })
      .returning();
    if (!msg) return null;                                    // reintento: ya existía

    await tx.update(imChannels).set({
      lastMessageAt: msg.createdAt,
      lastMessagePreview: preview(msg),
      messageCount: sql`${imChannels.messageCount} + 1`,
    }).where(eq(imChannels.id, input.channelId));

    // Contadores: +1 a todos menos al autor
    await tx.update(imChannelMembers).set({
      unreadCount: sql`${imChannelMembers.unreadCount} + 1`,
      mentionCount: sql`${imChannelMembers.mentionCount} + CASE WHEN ${imChannelMembers.userId} = ANY(${mentioned}) THEN 1 ELSE 0 END`,
    }).where(and(
      eq(imChannelMembers.channelId, input.channelId),
      ne(imChannelMembers.userId, input.senderUserId ?? NIL_UUID),
      isNull(imChannelMembers.leftAt),
    ));

    if (mentioned.length) await tx.insert(imMentions).values(/* … */).onConflictDoNothing();
    if (input.parentId) await tx.update(imMessages).set({ replyCount: sql`… + 1` }).where(eq(imMessages.id, input.parentId));
    return msg;
  });

  if (!row) return { id: (await findByNonce(input))!.id };

  await publishToMembers(row);          // best-effort: nunca rompe la persistencia
  await scheduleMentionEscalation(row); // solo si el usuario lo activó
  return { id: row.id };
}
```

**Regla que se hereda de `lib/tasks/hooks.ts`**: nada de tiempo real ni de notificaciones puede tirar una excepción hacia arriba. Si Redis está caído, el mensaje se guarda igual y aparece en el próximo render. Es exactamente el `failure-mode` que ya documenta `lib/whatsapp/realtime/publisher.ts`.

### 5.2 La API que consume el resto del producto: `bot.ts`

```ts
// lib/messaging/bot.ts
export async function postSystemEvent(args: {
  tenantId: string;
  channel: { slug: string } | { contextType: ImContextType; contextId: string; label: string };
  event: string;                    // 'call.missed', 'waitlist.slot_open', …
  title: string;
  body?: string;
  context?: { type: ImContextType; id: string; payload: Record<string, unknown> };
  actions?: ImAction[];             // botones que renderiza la tarjeta
  dedupeKey?: string;               // 'evt:call.missed:<callId>' — idempotencia igual que tasks
}): Promise<void>;
```

Es la única puerta de entrada que necesita el resto del código. Mismo contrato mental que `runTaskAutomation()`: best-effort, idempotente por `dedupeKey`, no lanza.

---

## 6. Superficie de API

Se sigue la convención existente: `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, validación con zod, errores con un helper `messagingErrorResponse` gemelo de `taskErrorResponse`.

| Método y ruta | Rol mínimo | Qué hace |
|---|---|---|
| `GET /api/messages/stream` | miembro | **SSE multiplexado.** Suscribe a `im:user:<id>`, heartbeat 15 s, refresca presencia por TTL |
| `GET /api/messages/rail` | miembro | Rail completo: canales + no leídos + presencia. Es lo que hidrata el sidebar y el dock |
| `POST /api/messages/channels` | operator | Crea canal `PUBLIC`/`PRIVATE`/`GROUP` |
| `POST /api/messages/channels/dm` | miembro | Abre o recupera el DM con otra persona (idempotente por `dedupe_key`) |
| `POST /api/messages/channels/context` | miembro | Abre o recupera el hilo de una entidad (`ensureContextChannel`) |
| `GET /api/messages/channels/[id]` | miembro del canal | Metadatos + miembros + fijados |
| `PATCH /api/messages/channels/[id]` | OWNER \| admin | Nombre, tema, archivar, silenciar, fijar en el rail |
| `POST /api/messages/channels/[id]/members` | OWNER \| admin | Invitar / quitar |
| `GET /api/messages/channels/[id]/messages` | miembro del canal | Página keyset: `?before=<iso>&limit=50` |
| `POST /api/messages/channels/[id]/messages` | miembro del canal | Envía (con `clientNonce`) |
| `POST /api/messages/channels/[id]/read` | miembro del canal | Marca leído hasta un mensaje; resetea contadores |
| `POST /api/messages/channels/[id]/typing` | miembro del canal | `SETEX` + publish. Throttle en cliente a 1 cada 3 s |
| `PATCH` / `DELETE /api/messages/[id]` | autor \| admin | Editar (con ventana de 15 min) / borrar blando |
| `POST /api/messages/[id]/reactions` | miembro del canal | Toggle de emoji |
| `POST /api/messages/[id]/pin` \| `/save` | miembro del canal | Fijar en canal / guardar para mí |
| `POST /api/messages/[id]/to-task` | operator | **Convierte el mensaje en Tarea** con contexto ya cargado |
| `POST /api/messages/attachments` | miembro | Sube a MinIO y devuelve la clave firmada |
| `GET /api/messages/mentions` | miembro | Bandeja "para mí" (sin leer / sin resolver) |
| `GET /api/messages/search?q=` | miembro | FTS español, acotado a los canales del usuario |

**Eventos que viajan por SSE** (`event:` + JSON, igual que hoy en WhatsApp):

```
message.new · message.updated · message.deleted · reaction.changed
channel.updated · channel.member_joined · channel.member_left
typing.start · typing.stop
presence.changed
unread.changed        ← el que mueve los badges sin recargar
mention.new           ← dispara el toast y el sonido
```

---

## 7. Diseño de interfaz (Aurora, sin dependencias nuevas)

### 7.1 Dos superficies, no una

Lo que hace la diferencia entre "otro chat" y "el equipo es más ejecutivo" es **no obligar a cambiar de página**. Por eso son dos superficies:

**A. Página completa `/dashboard/messages`** — tres columnas:

```
┌──────────────┬──────────────────────────────────┬──────────────────┐
│ RAIL         │ HILO                             │ CONTEXTO         │
│              │                                  │                  │
│ ⌕ buscar     │ #agenda · 4 personas        ⋯    │ ┌──────────────┐ │
│              │ ──────────────────────────────── │ │ María López  │ │
│ ★ Fijados    │  [tarjeta] Hueco libre 15:30     │ │ Implante     │ │
│  # general 3 │   Ana: se lo ofrezco a la lista  │ │ ☎ +34…       │ │
│  # agenda  ●  │   ♥2  💬1                        │ │ Próx: 12 sep │ │
│              │                                  │ │ [Ver ficha]  │ │
│ Canales      │   Lucía: ya está confirmada 🎉    │ │ [Llamar]     │ │
│  # urgencias │                                  │ └──────────────┘ │
│  # caja      │  ··· Ana está escribiendo        │ Tareas ligadas 2 │
│              │ ──────────────────────────────── │ Fijados        3 │
│ Directos     │ [ ✎ mensaje…      @ 📎 ⚡ ➤ ]     │ Archivos       5 │
│  ● Ana     2 │                                  │                  │
│  ○ Lucía     │                                  │                  │
└──────────────┴──────────────────────────────────┴──────────────────┘
```

**B. Dock flotante** — botón burbuja abajo a la derecha, presente en **todo** `/dashboard`. Abre un panel de 380 px con el rail y el hilo activo, sin abandonar la pantalla en la que estás. Es lo que permite que la recepcionista pregunte algo desde la ficha del paciente sin perder el sitio. Estado colapsado/expandido y último canal en `localStorage` (mismo patrón que `futura.sidebar.collapsed`).

### 7.2 Mapeo exacto a las primitivas existentes

| Elemento | Primitiva / utilidad | Notas |
|---|---|---|
| Contenedor de rail y contexto | `Card tone="glass"` + `.glass` | Vidrio sobre `.aurora-canvas`, coherente con el resto |
| Cabecera del hilo | `CardTopbar` con icono en chip | Idéntico a todas las páginas del panel |
| Ítem de canal activo | Barra de acento `linear-gradient(180deg,#7139e8,#ec4899)` | Copiar el `NavLink` del sidebar tal cual |
| Entrada de canales | `.stagger` + `--i` inline | La lista cae escalonada al abrir |
| Burbuja nueva | `animate-fade-up` | Ya está en `MessageBubble` de WhatsApp |
| Reacción al agregarse | `animate-pop` (cubic-bezier con rebote) | Micro-recompensa que hace que la gente reaccione |
| "Está escribiendo" | `Equalizer` o los tres puntos con `animate-bounce` | Ya existe `TypingBubble` |
| Enviar | `.sheen` en el botón primario | El barrido de luz al hacer clic |
| Presencia | `StatusDot tone="success"` + `Avatar` con anillo `.gradient-ring` | Anillo violeta = en línea |
| Quién leyó | `AvatarStack size="xs"` al pie del último mensaje | Ya está construido en `ui/stat.tsx` |
| Contador no leídos | Píldora violeta del sidebar | Prop `messagesBadge` gemelo de `tasksBadge` |
| Tarjeta de evento | `Card tone="mint"/"honey"/"coral"` + `Badge` | Color por tipo: hueco = mint, llamada perdida = coral, tarea = blossom |
| Mensaje fijado / decisión | `Callout` | Se apila arriba del hilo, colapsable |
| Skeleton de carga | `SkeletonRows` | Sin saltos de layout |
| Canal vacío | `EmptyState` | Con sugerencias de primer mensaje |
| Adjunto subiendo | `ProgressBar` + `.skeleton` | Barra fina bajo la burbuja optimista |
| Barrido de fondo del panel | `.aurora-canvas` + `animate-drift` | Ya heredado del layout |

**Todo respeta `prefers-reduced-motion`** porque el bloque global de `globals.css` ya lo apaga todo. Y la app es **light-only** a propósito: cero variantes `dark:`.

### 7.3 Los detalles que la hacen sentir inmediata

1. **Envío optimista.** La burbuja aparece con `animate-fade-up` y opacidad 0.6 antes de que responda el servidor; al confirmar el `client_nonce`, sube a opacidad 1 con una transición de 200 ms. Percepción de latencia cero.
2. **Composer con `/` y `@`.** `/tarea`, `/llamar`, `/paciente`, `/hueco`, `/decision` — un popover con `animate-zoom-in` filtrado a medida que escribís. `@` resuelve contra los miembros del tenant (`listTenantMembersSynced`), y `#` contra canales.
3. **Cambio rápido `⌘J`.** Modal con los canales por recencia. `⌘K` (el buscador global existente) suma hits de tipo `channel`, `person` y `message`.
4. **Salto a "no leídos".** Una línea divisoria roja "nuevos mensajes" con `animate-grow-x` al entrar a un canal con pendientes.
5. **Sonido y toast.** Un tono corto (WebAudio, sin archivo) para menciones y DM; toast con `animate-slide-right` en la esquina que enlaza al hilo. Silenciable por canal y con No Molestar por horario.
6. **Título de pestaña.** `(3) FUTURA` cuando hay menciones sin leer — el truco más barato que existe para que alguien vuelva.
7. **Arrastrar y soltar** un archivo sobre el hilo: overlay con `.spotlight` y borde punteado.
8. **Responder en hilo** abre un panel lateral deslizante (`animate-slide-right`), no una página nueva.

---

## 8. Integraciones — el verdadero valor

Cada integración es un enganche `postSystemEvent()` desde código que **ya existe**, más una acción de vuelta desde el chat.

### 8.1 Tareas ↔ Mensajes (la más importante)

| Dirección | Qué pasa | Dónde se engancha |
|---|---|---|
| Mensaje → Tarea | `POST /api/messages/[id]/to-task` llama a `createTask()` con `patientGhlContactId`, `callId` o `whatsappConversationId` heredados del `context_*` del mensaje. La tarjeta de la tarea reemplaza al mensaje en el hilo | `lib/tasks/service.ts` (sin cambios) + `tasks.im_message_id` |
| Tarea → hilo | Cada tarea tiene su hilo `CONTEXT` con `dedupe_key = 'task:<id>'`, creado la primera vez que alguien comenta. `TaskDetailPanel` deja de tener su propia caja de comentarios y monta el hilo | `components/tasks/TaskDetailPanel.tsx` |
| Comentarios existentes | `task_comments` sigue siendo el registro de **actividad** (`kind='activity'`); la conversación humana migra al hilo. Backfill: un script que porta `kind='comment'` a `im_messages` | `lib/tasks/service.ts:addComment` publica también al hilo |
| Asignación | Asignar una tarea a alguien le manda un DM del bot con la tarjeta y botón "Abrir" | `lib/tasks/service.ts` |
| Vencimientos | El `task-daily-sweep` publica un resumen en `#tareas`: qué venció, de quién | `worker/jobs/task-daily-sweep.ts` |

### 8.2 Waitlist ↔ Mensajes

- **Hueco liberado** (`cancelled_slots`, `lib/waitlist/engine.ts`) → tarjeta en `#agenda` con el hueco, los candidatos que matchearon y botones **Ofrecer ahora** / **Llamar yo** / **Dejar pasar**. Hoy eso solo dispara una oferta automática; con el chat, el equipo ve la jugada y puede intervenir.
- **`book_failed`** (aceptó y no quedó agendado) → ya crea tarea `WAITLIST_ACCEPTED_UNSCHEDULED`; ahora además grita en `#urgencias` con mención al rol de recepción. Es plata que se está yendo por la puerta.
- **Oferta expirada sin respuesta** → nota en el hilo del paciente.

### 8.3 Contactos / pacientes ↔ Mensajes

- **Hilo por paciente**: `dedupe_key = 'patient:<ghlContactId>'`. Se abre desde la ficha del contacto y desde cualquier tarjeta. Toda la conversación interna sobre esa persona vive junta, para siempre.
- **`@paciente`** en el composer inserta un chip que renderiza tarjeta con nombre, teléfono, próxima cita y accesos a **Llamar** / **Abrir WhatsApp** / **Ver ficha**.
- En `contact-detail-dialog.tsx`, una pestaña **Equipo** con el hilo interno del paciente.

### 8.4 WhatsApp ↔ Mensajes

- **Handoff del agente** (`worker/jobs/whatsapp-process.ts`) → tarjeta en `#whatsapp` con las últimas 3 líneas y botón **Tomar la conversación**. Hoy solo crea tarea; el chat lo hace visible en segundos.
- **"Consultar al equipo"** desde el inbox de WhatsApp: abre el hilo `wa:<conversationId>` con el fragmento citado. Reemplaza el reflejo de sacar una captura y mandarla al grupo personal.
- **Notas internas** de WhatsApp (`internal_note = true`) se espejan al hilo del paciente, para que exista un solo lugar donde mirar.

### 8.5 Llamadas ↔ Mensajes

- **Llamada perdida / transferida sin atender** (`worker/jobs/process-call.ts`) → tarjeta en `#urgencias` con intención, resumen y **reproductor de audio embebido** (`components/dashboard/audio-player.tsx` ya existe). Escuchar los 20 segundos clave sin salir del chat es lo que hace que se devuelva la llamada.
- **Compartir una llamada**: botón en `/dashboard/calls/[id]` que la publica en un canal con el resumen.

### 8.6 Recordatorios ↔ Mensajes

- **Cita sin confirmar a T-Xh** (`reminder-fallback-check`) → tarjeta con **Llamar** / **Reasignar** / **Liberar el hueco** (esto último enlaza con waitlist y cierra un ciclo completo).

### 8.7 Analytics ↔ Mensajes (en las dos direcciones)

**Analytics dentro del chat** — un `#reportes` donde el bot publica:
- resumen diario a la hora de apertura: llamadas atendidas, citas agendadas, huecos rescatados, no-shows;
- resumen semanal con la comparativa contra la semana previa y una `Sparkline` (ya existe en `ui/stat.tsx`);
- alertas por umbral: "las llamadas perdidas subieron 40 % respecto de la media" con enlace a Analytics.

Se implementa como job BullMQ `im-digest` con cron por timezone de clínica, exactamente igual que `task-routines-tick`.

**El chat dentro de Analytics** — una pestaña **Equipo** en `/dashboard/analytics` con métricas que hoy nadie tiene:

| Métrica | Cómo se calcula | Para qué sirve |
|---|---|---|
| Tiempo de reacción a evento | `im_messages.created_at` del primer mensaje humano − `created_at` de la tarjeta del bot | Es *el* número: cuánto tarda el equipo en tomar un hueco libre o una llamada perdida |
| Eventos sin reacción | Tarjetas de evento sin respuesta ni tarea creada en X h | Detecta lo que se cae por el agujero |
| Menciones sin resolver por persona | `im_mentions` con `resolved_at IS NULL` | Sobrecarga individual visible antes de que alguien reviente |
| Mensajes → tareas | Ratio `to-task` sobre total | Cuánta conversación se convierte en acción |
| Actividad por franja horaria | Histograma sobre `created_at` | Dónde poner los turnos |

Estas métricas usan `Recharts` (ya instalado) y `chart-theme.ts` (ya existe).

### 8.8 Resumen de puntos de enganche en código

| Archivo existente | Evento a publicar |
|---|---|
| `worker/jobs/process-call.ts` | `call.missed`, `call.transferred_unanswered` |
| `worker/jobs/whatsapp-process.ts` | `wa.handoff` |
| `worker/jobs/reminder-fallback-check.ts` | `reminder.no_response` |
| `worker/jobs/task-daily-sweep.ts` | `tasks.digest` |
| `lib/waitlist/engine.ts` | `waitlist.slot_open`, `waitlist.book_failed` |
| `app/api/webhooks/ghl/appointment/route.ts` | `appointment.cancelled`, `appointment.no_show` |
| `lib/tasks/service.ts` | `task.assigned`, `task.completed` |

**Todos van con `void postSystemEvent(...).catch(...)`**, igual que los hooks de Tareas. Ninguno puede romper el flujo que lo invoca.

---

## 9. Notificaciones y contadores

**Unificar la campana.** Hoy `topbar.tsx` deriva "notificaciones" leyendo las últimas llamadas (`lib/data/notifications.ts`) — no hay cola persistente y el "leído" vive en `localStorage`. Es frágil y no sobrevive a cambiar de dispositivo. Propuesta: la campana pasa a leer **menciones + DM sin leer + tarjetas de evento sin atender**, con estado real en `im_mentions.read_at`. Las notificaciones derivadas de llamadas se convierten en tarjetas del canal `#urgencias`, así que la fuente se unifica sin perder nada.

Escalera de notificación, de menos a más intrusiva:

1. Badge en el sidebar y en el dock (siempre).
2. Toast + sonido si la pestaña está activa (silenciable).
3. Título de pestaña con contador (siempre que haya menciones).
4. Notificación de escritorio vía `Notification` API con permiso explícito (opt-in).
5. **Escalado a WhatsApp** si una mención sigue sin leer después de N minutos y el usuario lo activó — job `im-mention-escalate` con delay. Reutiliza el envío de WhatsApp existente. Apagado por defecto: mal calibrado, esto se vuelve spam y la gente silencia todo.

---

## 10. Permisos, seguridad y RGPD

**Roles** (se mapean sobre `tenant_memberships.role`, vía `normalizeRole()` que ya existe):

| Rol | Puede |
|---|---|
| `viewer` | Leer canales públicos, escribir en sus DM. No publica en canales de operación |
| `operator` | Todo lo anterior + escribir en canales, crear canales `PRIVATE`/`GROUP`, convertir a tarea |
| `admin` | Todo + crear canales públicos, archivar, expulsar miembros, cambiar retención, exportar |

Además: **membresía por canal**, verificada en cada endpoint. Un canal privado no aparece ni en búsqueda ni en el rail para quien no es miembro.

**Seguridad:**
- Todo endpoint arranca por `requireMessagingRole()` y valida pertenencia al canal — nunca se confía en un `channelId` del cliente.
- Adjuntos en bucket **privado** con URLs firmadas de corta duración, no público como `whatsapp-media`. Un adjunto puede ser una radiografía.
- Sanitizar el markdown en render (subconjunto acotado: negrita, cursiva, código, enlaces, listas). `marked` ya está en dependencias; hay que configurarlo restrictivo o renderizar a nodos propios.
- Rate limit por usuario (reutilizar el patrón de `lib/whatsapp/rate-limit.ts`).
- `audit_logs` para: borrado de mensajes, cambios de miembros, archivado de canal, export.

**RGPD / LOPDGDD** — esto es una clínica y va a haber datos de salud en el chat:
- **Retención configurable por tenant** (defecto 24 meses). Job `im-retention-sweep` que borra en duro lo vencido. Se documenta en la política de privacidad de la clínica.
- **Export por paciente**: dado un `ghlContactId`, devolver todos los mensajes con ese contexto — es lo que sostiene un derecho de acceso.
- **Borrado por paciente**: mismo criterio.
- Un `Callout` en el onboarding del módulo: *"esto es un canal interno; no es el canal de comunicación con el paciente"*. Diferencia legal importante.
- Nada de datos de paciente en el cuerpo de las notificaciones de escritorio (solo "Ana te mencionó en #agenda").

---

## 11. Rendimiento y escala

| Riesgo | Mitigación |
|---|---|
| Conexiones Redis por usuario | Hub compartido (§3.2): 1 por réplica en lugar de 1 por usuario |
| `count(*)` de no leídos en cada render del layout | `unread_count` desnormalizado + una sola query agregada por usuario |
| Hilos largos | Paginación keyset `(created_at, id)`, 50 por página, scroll infinito hacia arriba. Nada de `OFFSET` |
| Listas de miles de mensajes en el DOM | Ventana de render de ~200 mensajes; el resto se descarta al scrollear (virtualización manual, sin librería) |
| Fan-out en canales grandes | `PUBLISH` por miembro en un `pipeline()`; por encima de 50 miembros, se pasa a canal por-canal con suscripción dinámica |
| Idle timeout de Traefik | Heartbeat de 15 s ya probado en el stream de WhatsApp |
| Redeploy de Dokploy corta las SSE | `EventSource` reconecta solo; al reconectar se hace un `GET /rail` para resincronizar lo perdido |
| Mensajes perdidos durante la desconexión | Cada evento SSE lleva `seq` (el `created_at` del mensaje); al reconectar se piden los posteriores al último visto |

---

## 12. Plan por fases

Cada fase deja algo usable en producción. Las estimaciones son de trabajo enfocado.

### Fase 1 — Núcleo (≈ 3–4 días)
Migración `0019`, esquema Drizzle, `lib/messaging/{auth,types,events,publisher,service,queries,channels}`, hub de realtime, SSE multiplexado, endpoints de canal y mensaje, página `/dashboard/messages` con rail + hilo + composer, entrada en el sidebar con badge, canales sembrados (`#general`, `#agenda`, `#urgencias`), DM entre miembros.
→ **Entregable**: el equipo ya puede dejar el grupo de WhatsApp.

### Fase 2 — Vivo y expresivo (≈ 2–3 días)
Typing, presencia, reacciones, respuestas en hilo, adjuntos a MinIO, edición y borrado blando, fijados, guardados, envío optimista, divisor de no leídos, sonido, toasts, título de pestaña, `⌘J`, `⌘K` extendido, búsqueda FTS.
→ **Entregable**: se siente como una app de mensajería de verdad, no como un formulario.

### Fase 3 — Contexto e integraciones (≈ 3–4 días)
`bot.ts` + `postSystemEvent`, tarjetas de evento con acciones, hilos `CONTEXT` (paciente, tarea, llamada, conversación de WhatsApp, hueco), los 7 enganches de §8.8, mensaje → tarea, hilo dentro de `TaskDetailPanel`, pestaña Equipo en la ficha de contacto, "consultar al equipo" desde el inbox de WhatsApp.
→ **Entregable**: aquí es donde el módulo empieza a pagar. Es la fase que no hay que recortar.

### Fase 4 — Dock y notificaciones (≈ 2 días)
Dock flotante en todo el panel, bandeja de menciones, campana unificada, preferencias por usuario (sonido, No Molestar, escalado), notificaciones de escritorio.
→ **Entregable**: se responde sin cambiar de pantalla; nada se queda sin ver.

### Fase 5 — Analytics, gobierno y pulido (≈ 2–3 días)
Job de digests, alertas por umbral, pestaña Equipo en Analytics, retención y export por paciente, auditoría, `/comandos`, onboarding del módulo en el tour, e2e.
→ **Entregable**: medible, auditable y defendible ante una inspección.

**Total ≈ 12–16 días.** Fases 1–3 (~9 días) ya entregan el valor central.

---

## 13. Pruebas

Siguiendo lo que ya hay en `apps/web/tests/unit/` (vitest, 30+ archivos):

| Archivo | Qué cubre |
|---|---|
| `messaging-unread.test.ts` | Aritmética de contadores: enviar, leer, leer parcial, autor no se cuenta a sí mismo, reconciliación |
| `messaging-mentions.test.ts` | Parseo de `@nombre`, `@todos`, menciones dentro de bloques de código (no cuentan), no resueltas |
| `messaging-auth.test.ts` | Matriz rol × acción, y que un no-miembro no lee un canal privado |
| `messaging-dedupe.test.ts` | `client_nonce` idempotente; `dedupe_key` de canales de contexto y de eventos |
| `messaging-serialize.test.ts` | `serializeMessage()` estable server→client (mismo contrato que el de WhatsApp) |
| `realtime-hub.test.ts` | Refcount de suscripciones, limpieza al cerrar, re-suscripción tras `ready` |

E2E (Playwright, ya configurado): dos contextos de navegador, uno envía y el otro recibe sin recargar; mención que enciende el badge; mensaje convertido en tarea que aparece en el tablero.

---

## 14. Riesgos y decisiones abiertas

| # | Riesgo / decisión | Recomendación |
|---|---|---|
| 1 | **Colisión de numeración de migraciones** entre `supabase/migrations/` y `apps/web/supabase/migrations/` | Usar la raíz (`0019_internal_messaging.sql`) y abrir un chore para consolidar las dos carpetas antes de que muerda |
| 2 | **¿Módulo contratable o core?** | **Core**, como Tareas. Un chat que solo tienen algunas clínicas no genera el hábito, y el hábito es lo que hace que funcione |
| 3 | **Adopción**: si el equipo sigue en el WhatsApp personal, esto no sirve de nada | Las tarjetas de evento son la palanca: lo que *solo* se ve acá (huecos libres, llamadas perdidas con audio) los trae. Sembrar los tres canales y el tour del módulo desde el día uno |
| 4 | **Ruido**: si el bot publica todo, se silencia todo | Empezar publicando **solo** llamada perdida, hueco libre y handoff de WhatsApp. Cada evento nuevo, con umbral configurable |
| 5 | **Doble registro de comentarios de tarea** (`task_comments` vs. `im_messages`) | Hilo como única conversación humana; `task_comments` queda para actividad automática. Backfill de los comentarios existentes |
| 6 | **Push móvil real** (fuera de la pestaña) | Fuera de alcance. Requiere PWA + service worker + VAPID. Escalar a WhatsApp cubre el 90 % del caso con lo que ya hay |
| 7 | **Llamadas de voz / huddles internos** | Fuera de alcance. Retell es para pacientes, no para el equipo |
| 8 | **Datos de salud en el chat** | Retención + export + aviso en el onboarding. No opcional: es una clínica |
| 9 | **Búsqueda FTS en español** con `to_tsvector('spanish', …)` | Suficiente. Nada de pgvector: el precedente de RAG en este repo ya decidió que para volúmenes por tenant no hace falta |
| 10 | **Traducción del stream de WhatsApp al hub** | Hacerla en la Fase 2 mientras el hub está fresco; deja de haber dos implementaciones de realtime |

---

## 15. Recomendación

Ejecutar Fases 1–3 como un bloque (~9 días) y evaluar con una clínica real antes de las Fases 4–5. La pieza que define si esto funciona no es el chat: es el **catálogo de tarjetas de evento** de la Fase 3. Un chat interno más, la clínica ya lo tiene gratis en WhatsApp. Lo que no tiene en ninguna parte es un sitio donde el hueco de las 15:30 aparece solo, con los tres pacientes que lo querían y un botón para ofrecérselo.
