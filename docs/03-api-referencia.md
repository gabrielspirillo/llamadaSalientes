# Referencia de API / Endpoints

> Parte de la [Documentación para Desarrolladores](./README.md). Ver también: [Arquitectura](./01-arquitectura.md) · [Setup local](./02-setup.md) · [Deployment](./04-deployment.md).

## Swagger / OpenAPI

La API está especificada en **OpenAPI 3.0**:

- **Spec**: [`apps/web/public/openapi.yaml`](../apps/web/public/openapi.yaml) — servido en producción en `https://app.futuradigital.es/openapi.yaml`.
- **Swagger UI interactivo**: `https://app.futuradigital.es/api/docs` (en local: `http://localhost:3000/api/docs`). Requiere sesión de Clerk; el "Try it out" usa tus cookies de sesión, así que las llamadas se ejecutan como tu usuario/organización.
- También podés abrir el YAML en [editor.swagger.io](https://editor.swagger.io) o importarlo en Postman/Insomnia.

> **Mantenimiento**: al agregar o cambiar un endpoint en `apps/web/app/api/**`, actualizá `openapi.yaml` en el mismo PR.

## Autenticación

| Mecanismo | Quién lo usa | Cómo funciona |
|---|---|---|
| **Sesión Clerk** (cookie `__session`) | Todos los endpoints del dashboard | `middleware.ts` exige sesión; el handler resuelve `orgId` → tenant (`getCurrentTenant()`). Sin sesión/org/tenant → `401` |
| **Roles por tenant** | Módulos Recordatorios y Waitlist | `viewer(0) < operator(1) < admin(2)` según `tenant_memberships`. Rol insuficiente → `403` |
| **Intake key** | `POST /api/leads/intake` | `Authorization: Bearer <key>` o `?key=`. Key = `HMAC-SHA256("intake:{tenantId}", ENCRYPTION_KEY)` |
| **Firmas de webhook** | `/api/webhooks/*`, `/api/retell/tools`, `/api/zadarma/webhook` | Cada proveedor firma distinto (ver §Webhooks) |
| **CORS + rate-limit** | `POST /api/public/demo-call` | Origins de `FUTURA_DEMO_ALLOWED_ORIGINS`; 1 llamada/60 s por número |

Convenciones comunes: todos los handlers usan `runtime='nodejs'` y `dynamic='force-dynamic'`; los bodies se validan con **Zod** (`422` o `400` con el detalle); todas las queries filtran por `tenant_id`.

## Endpoints de negocio (sesión Clerk)

### Sistema, contactos y llamadas

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Health check (público) |
| GET | `/api/contacts` | Lista contactos del CRM GHL (`q`, `page`, `limit`) |
| GET | `/api/contacts/{id}` | Contacto GHL + últimas 20 llamadas locales + citas |
| POST | `/api/calls/outbound` | Dispara llamada saliente individual (body: `toNumber`, `patientName?`, `useCase?`, `dynamicVars?`…) |
| GET/HEAD | `/api/calls/{id}/recording` | Proxy del audio de la grabación desde Retell (`425` si aún no está lista) |
| GET | `/api/insights` | Insights IA (Gemini) sobre las últimas 50 llamadas |
| GET | `/api/notifications` | Notificaciones derivadas de llamadas de los últimos 7 días |
| GET | `/api/search` | Búsqueda global: llamadas, tratamientos y contactos GHL (`q` ≥ 2 chars) |
| POST | `/api/admin/backfill-intents` | Re-clasifica intents de llamadas sin intent con Gemini (hasta 50) |
| GET | `/api/admin/inspect-call/{id}` | Diagnóstico: fila local + estado del call en Retell |

### Campañas outbound

| Método | Ruta | Descripción |
|---|---|---|
| GET / POST | `/api/outbound/campaigns` | Listar / crear campaña con 1–5000 targets (queda en `draft`) |
| GET | `/api/outbound/campaigns/{id}` | Detalle + targets |
| POST | `/api/outbound/campaigns/{id}/dispatch` | Crea el **batch call en Retell** (idempotente; pasa targets `pending` → `queued`) |

### Telefonía

| Método | Ruta | Descripción |
|---|---|---|
| GET / POST | `/api/telephony/credentials` | Estado (enmascarado) / guardar credenciales Twilio o Zadarma — se validan contra el proveedor y se guardan **cifradas** |
| POST | `/api/telephony/caller-id/start` | Inicia verificación del Caller ID (Twilio: llamada con código DTMF; Zadarma: debe estar pre-verificado en cabinet) |
| GET | `/api/telephony/caller-id/status` | Poller del estado de verificación |
| DELETE | `/api/telephony/caller-id` | Desvincula el Caller ID |
| GET | `/api/telephony/inbound/numbers` | Lista números disponibles en la cuenta del proveedor |
| POST | `/api/telephony/inbound/configure` | Configura el número entrante (`route: agent\|forward`); en Twilio setea los webhooks automáticamente |

### Recordatorios (roles: viewer/operator/admin)

| Método | Ruta | Rol mín. | Descripción |
|---|---|---|---|
| GET | `/api/reminders` | viewer | Lista recordatorios (filtros `status`, `channel`, `from`, `to`, `include=skipped`) |
| POST | `/api/reminders/{id}/mark` | operator | Marca manualmente (`confirm`/`reschedule`/`cancel`); remueve jobs pendientes |
| POST | `/api/reminders/backfill?days=N` | admin | Sincroniza citas desde GHL y materializa recordatorios (máx 60 s) |
| POST | `/api/reminders/preview` | viewer | Render de un recordatorio sin enviar |
| GET / POST | `/api/reminders/rule-sets` | viewer / admin | Rule sets (`GLOBAL` único por tenant, o por tratamiento) |
| PATCH / DELETE | `/api/reminders/rule-sets/{id}` | admin | — |
| GET / POST | `/api/reminders/rules` | viewer / admin | Reglas: `offsetMinutes`, canal primario y fallback |
| PATCH / DELETE | `/api/reminders/rules/{id}` | admin | — |
| GET / POST | `/api/reminders/templates` | viewer / admin | Plantillas por regla + driverScope (`whatsapp_cloud`/`whatsapp_twilio`/`whatsapp_evolution`/`voice_retell`) |
| PATCH / DELETE | `/api/reminders/templates/{id}` | admin | — |
| POST | `/api/reminders/test-send` | admin | ⚠️ Envío/llamada **real** de prueba (no persiste reminder) |

### Waitlist (roles: viewer/operator/admin)

| Método | Ruta | Rol mín. | Descripción |
|---|---|---|---|
| POST | `/api/waitlist/entries` | operator | Alta manual (única por cita GHL) |
| PATCH | `/api/waitlist/entries/{id}` | operator | Estado (`ACTIVE`/`PAUSED`/`REMOVED`), notas, ventana horaria |
| POST | `/api/waitlist/offers/{id}/cancel` | operator | Cancela oferta `PENDING`/`SENT` y remueve sus jobs |
| POST | `/api/waitlist/preview` | viewer | Render de la oferta sin enviar |
| POST | `/api/waitlist/test-send` | admin | ⚠️ Envío/llamada **real** de prueba |
| GET / PUT | `/api/waitlist/templates` | viewer / admin | Plantillas (upsert por driverScope) |
| PATCH | `/api/waitlist/treatments` | admin | Elegibilidad de tratamiento para waitlist |
| GET / PATCH | `/api/waitlist/settings` | viewer / admin | Configuración (TTLs, channelMode, umbrales de distancia…) |

### WhatsApp y otros

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/whatsapp/conversations/{id}/stream` | **SSE** en tiempo real de una conversación (Redis pub/sub; heartbeat cada 15 s) |
| POST | `/api/retell/web-call` | Crea web call WebRTC de prueba contra el agente del tenant |
| GET | `/api/ghl/oauth/authorize` | Inicia OAuth de GoHighLevel (redirect al marketplace) |
| GET | `/api/ghl/oauth/callback` | Callback OAuth → guarda tokens cifrados, redirect al dashboard |

## Endpoints públicos

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/leads/intake?tenant=<slug>` | Intake key | Recibe un lead y dispara llamada saliente |
| POST | `/api/public/demo-call` | CORS + rate-limit | Demo de la landing: llama al visitante con el tenant demo |

## Tools del agente de voz — `POST /api/retell/tools`

Retell invoca este endpoint cuando el agente ejecuta una función durante una llamada (firma `x-retell-signature`, secreto `RETELL_API_KEY`). Siempre responde `200` con `{ result: "<texto para el agente>" }`. El tenant se resuelve por `metadata.tenant_id` o por el número destino; si `metadata.source='landing_demo'`, las tools operan contra el GHL de demo.

| Tool | Argumentos | Qué hace |
|---|---|---|
| `check_availability` | `treatment_name`, `preferred_date` | Huecos libres del calendario GHL (hasta 4, con `start_time` ISO exacto) |
| `book_appointment` | `start_time`, `treatment_name`, `contact_id?`/`phone?` | Crea la cita en GHL + cache local |
| `cancel_appointment` | `appointment_id` | Cancela la cita en GHL |
| `get_patient_info` | `phone` | Busca el contacto en GHL |
| `register_patient` | `first_name`, `phone`, `last_name?`, `email?` | Crea el contacto si no existe (idempotente) |
| `set_lead_email` | `email`, `phone?` | Actualiza el email del contacto |
| `list_treatments` | — | Tratamientos activos del tenant (BD) |
| `get_treatment_details` | `name` | Detalle de tratamiento con matching semántico (RAG) |
| `search_faqs` | `query` | FAQs por similitud semántica con fallback keyword |
| `accept_waitlist_offer` / `decline_waitlist_offer` | `offer_id` | Acepta/rechaza oferta de waitlist desde la llamada |

## Webhooks (receptores de terceros)

Públicos a nivel middleware; **cada uno valida su propia firma**:

| Ruta | Proveedor | Verificación | Efecto principal |
|---|---|---|---|
| `POST /api/webhooks/clerk` | Clerk | Svix (`CLERK_WEBHOOK_SIGNING_SECRET`) | Crea/actualiza `tenants` (con seed de tratamientos/FAQs), `users`, `tenant_memberships` |
| `POST /api/webhooks/retell` | Retell | `x-retell-signature` (HMAC, `RETELL_API_KEY`) | Upsert `calls`/`call_events`, actualiza targets outbound, encola job **`process-call`** |
| `POST /api/webhooks/ghl/contact` | GHL | Matcheo `locationId` (sin firma en v1) | `ContactCreate` → dispara llamada saliente |
| `POST /api/webhooks/ghl/appointment` | GHL | Matcheo `locationId` (sin firma en v1) | Mantiene `appointments_cache`; cancelaciones alimentan el motor de **waitlist** |
| `POST /api/webhooks/whatsapp/twilio` | Twilio | `X-Twilio-Signature` (HMAC-SHA1, auth token por tenant) | Persiste mensaje, encola **`wa-process`** (debounce 5 s) |
| `POST /api/webhooks/whatsapp/twilio/status` | Twilio | ídem | Actualiza `deliveryStatus` de mensajes |
| `POST /api/webhooks/whatsapp/evolution` | Evolution API | Matcheo `instance` | QR/estado de conexión + mensajes → **`wa-process`** |
| `GET+POST /api/webhooks/whatsapp/cloud` | Meta | GET: `WHATSAPP_VERIFY_TOKEN` · POST: `X-Hub-Signature-256` (app secret por tenant) | Mensajes Cloud API → **`wa-process`** |
| `POST /api/twilio/inbound-voice` | Twilio Voice | — (solo TwiML) | Conecta la llamada al agente Retell vía `<Sip>` o desvía a humano |
| `POST /api/twilio/sms-passthrough` | Twilio SMS | — | Captura/reenvía SMS (OTPs) |
| `POST /api/twilio/voice-record` | Twilio Voice | — | Graba llamada (OTPs de voz) |
| `GET+POST /api/zadarma/webhook` | Zadarma | Handshake `zd_echo` + firma md5 en `NOTIFY_START` (secret por tenant) | Routing de entrantes: `{redirect: "sip:<agente>@<RETELL_SIP_DOMAIN>"}`, forward o hangup |

Los mensajes de WhatsApp entrantes pasan primero por los handlers de respuesta de **waitlist** y **recordatorios** (botones/texto); solo si nadie los consume se encola el job del agente IA.

## Jobs BullMQ encolados por la API

| Cola | Encolada desde | Consumida por |
|---|---|---|
| `process-call` | Webhook Retell | `worker/jobs/process-call.ts` |
| `wa-process` | Webhooks WhatsApp (Twilio/Evolution/Cloud) | `worker/jobs/whatsapp-process.ts` |
| `reminder-send` / `reminder-fallback-check` | Materialización de recordatorios (backfill, webhooks de citas) | `worker/jobs/reminder-*.ts` |
| `waitlist-offer-send` / `waitlist-offer-expire` | Motor de waitlist (webhook de citas GHL) | `worker/jobs/waitlist-offer-*.ts` |

Si `REDIS_URL` no está configurada, el encolado es no-op en dev (con warning en prod).

## Convenciones de error

| Código | Significado |
|---|---|
| `400` | JSON inválido, parámetros faltantes o fallo de negocio (`{ error, reason? }`) |
| `401` | Sin sesión Clerk / firma de webhook inválida / intake key inválida |
| `403` | Rol insuficiente (reminders/waitlist) o firma Zadarma inválida |
| `404` | Recurso inexistente o de otro tenant |
| `409` | Conflicto (duplicado: rule set global, template por driver, entrada de waitlist…) |
| `422` | Validación Zod fallida (`{ error: <zod flatten> }`) o credenciales rechazadas |
| `425` | Grabación aún no disponible |
| `429` | Rate limit (demo pública) |
| `502` | Fallo de un proveedor externo (Retell, Gemini, envío WhatsApp) |
| `503` | Dependencia no configurada (`RETELL_API_KEY`, `GEMINI_API_KEY`, `REDIS_URL`…) |
