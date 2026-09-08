# CLAUDE.md

Guía persistente para futuras sesiones de Claude trabajando en este repo.

## ⚠️ Reglas críticas (leer antes de cambiar nada de infra)

La app se migró de Vercel + Supabase + Inngest a un stack **self-hosted en Dokploy**. Las siguientes SaaS están **deprecadas y NO deben volver a usarse**:

| ❌ NO usar                  | ✅ Usar en su lugar                              |
|----------------------------|--------------------------------------------------|
| Supabase (Postgres + Auth) | Postgres self-hosted en Dokploy + Clerk (sigue)  |
| Supabase Storage           | MinIO self-hosted (bucket `whatsapp-media`)      |
| Inngest                    | BullMQ + Redis (worker process separado)         |
| Vercel (hosting)           | Dokploy (Docker + Traefik)                       |
| Cloudflare R2              | **No usar**. Recordings van también a MinIO (bucket `retell-recordings`). El módulo `lib/r2/client.ts` se mantiene por compat pero apunta a MinIO via `R2_ENDPOINT`. |

Si encontrás código que importe `@supabase/supabase-js`, `inngest`, o el cliente R2 con la URL nativa de Cloudflare → **eliminar / refactorizar** a su equivalente self-hosted.

## Stack productivo

**Host**: VPS Hostinger `72.60.212.232` (root SSH habilitado con key ed25519).
**Orchestrator**: Dokploy v0.28.8 en `https://vpsdokploy.futuradigital.es`.
**Proyecto Dokploy**: `Cliniq Production` (id `U3-2CBc_BxA-kgCkDSRN1`, env id `AVudgZe1dWT5lpvq7_3eU`, org `l-VR189MHaOcP8O_Vg7I_`).

| Servicio          | Tipo Dokploy   | App name (Swarm)            | Dominio público                                    | Notas                                           |
|-------------------|----------------|------------------------------|----------------------------------------------------|-------------------------------------------------|
| cliniq-postgres   | Database (PG16)| `cliniq-postgres-hn8mnb`     | interno (port 5432)                                | `cliniq` user / `cliniq` db. Persisted volume.  |
| cliniq-redis      | Database (R7)  | `cliniq-redis-p3hfxn`        | interno (port 6379)                                | password protected. Para BullMQ.                |
| cliniq-minio      | Application    | `cliniq-minio-qw28tw`        | `s3.futuradigital.es` (API), `minio.futuradigital.es` (console) | Buckets: `whatsapp-media` (público read), `retell-recordings` (privado). |
| cliniq-web        | Application Git| `cliniq-web-n1jguw`          | `app.futuradigital.es`                             | Next.js 15 standalone. Branch tracked: `main`.  |
| cliniq-worker     | Application Git| `cliniq-worker-fwxgf9`       | sin HTTP                                           | BullMQ worker. Branch tracked: `main`.          |

**Hostnames internos** (red Docker `dokploy-network`): los servicios se llaman entre sí por el appName completo. Ej:
- `DATABASE_URL = postgres://cliniq:<pwd>@cliniq-postgres-hn8mnb:5432/cliniq`
- `REDIS_URL = redis://default:<pwd>@cliniq-redis-p3hfxn:6379`
- `S3_ENDPOINT = http://cliniq-minio-qw28tw:9000` (interno) / `S3_PUBLIC_BASE_URL = https://s3.futuradigital.es` (público para URLs en el inbox UI).

Auto-deploy está activado: cualquier push a `main` que toque archivos en los watchPaths configurados dispara redeploy automático (~3–5 min para web, ~2 min para worker).

**Los dos servicios Git clonan por SSH, no por HTTPS.** Con `customGitUrl` en
`https://github.com/...` los despliegues **manuales** fallaban en 0,3 s con
`could not read Username for 'https://github.com'`. Los disparados por push sí
funcionaban, y eso enmascaraba el problema: el worker se quedó sin desplegar
desde el 1 de septiembre sin que nadie lo notara. Configuración correcta, ya
aplicada en `cliniq-web` y `cliniq-worker`:

- `customGitUrl` = `git@github.com:gabrielspirillo/llamadaSalientes.git`
- `customGitSSHKeyId` = la clave llamada **`github`** en Dokploy → SSH Keys
  (registrada como deploy key en el repo; la otra, `github2`, no se comprobó)

Si vuelve a fallar el clonado, lo primero es mirar si alguien devolvió la URL a HTTPS.

## Env vars del stack

Vars críticas y dónde se setean. Lista completa en `.env.example`.

**Build args** (necesarias también en build de Dokploy para `next build` no crashee al prerender Clerk):
- `NEXT_PUBLIC_APP_URL=https://app.futuradigital.es`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`
- `DATABASE_URL`, `DIRECT_URL`
- `ENCRYPTION_KEY`

**Clerk en local**: las claves de Clerk son obligatorias en producción y
opcionales en desarrollo (`lib/env.ts`). Sin ellas, `@clerk/nextjs` arranca en
modo *keyless* y crea una instancia temporal, que es lo que permite levantar el
panel en local sin repartir las claves del entorno real. La instancia temporal
queda en `apps/web/.clerk/` (ignorado por git).

**Runtime env**: ver `.env.example`. Las que cambiaron respecto al setup viejo:
- ❌ Eliminadas: `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_WHATSAPP_BUCKET`
- ✅ Nuevas: `REDIS_URL`, `S3_ENDPOINT`, `S3_PUBLIC_BASE_URL`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_WHATSAPP`, `S3_FORCE_PATH_STYLE`
- ✅ R2 ahora apunta a MinIO: `R2_ENDPOINT=http://cliniq-minio-qw28tw:9000`, `R2_REGION`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=retell-recordings`, `R2_FORCE_PATH_STYLE=true`

## SaaS que SÍ siguen activos

| Servicio   | Para qué                                       | Notas operativas                                                                 |
|------------|------------------------------------------------|----------------------------------------------------------------------------------|
| Clerk      | Auth (login + organizations multi-tenant)      | Webhook URL en dashboard apunta a `https://app.futuradigital.es/api/webhooks/clerk`. Test keys en uso actualmente. |
| Retell     | Voice AI (inbound + outbound)                  | API key `RETELL_API_KEY`. Webhook signing key todavía PENDIENTE. SIP trunk Zadarma cargado en Retell dashboard (sin SIP REGISTER persistente — Zadarma muestra offline, es normal). |
| Twilio     | WhatsApp + SMS (cuando se use)                 | Credenciales globales `TWILIO_ACCOUNT_SID/API_KEY/API_SECRET`. Webhook pendiente reapuntar a `app.futuradigital.es`. |
| Zadarma    | Telefonía (DIDs + SIP trunk)                   | Cabinet `cabinet.zadarma.com`. Inbound webhook configurado a `app.futuradigital.es/api/zadarma/webhook`. No expone API para setear webhook. |
| OpenAI     | Whisper transcripciones + fallback agente WA   | `OPENAI_API_KEY`                                                                 |
| Gemini     | Vision (imágenes/PDFs WA) + agente WA primario | `GEMINI_API_KEY` (pendiente)                                                     |
| GoHighLevel| CRM por tenant (contactos, calendar)           | Soporta OAuth (client_id/secret) y PIT (`pit-...`). Per-tenant en BD encrypted.  |

## Acceso al server

SSH key ya instalada como `~/.ssh/dokploy_server` en codespaces previos. Para una sesión nueva:

```bash
# Si la sesión actual no tiene la key, regenerala y mandala vía paramiko:
pip3 install --quiet paramiko
ssh-keygen -t ed25519 -f ~/.ssh/dokploy_server -N "" -C "claude-code@codespace"
# Después instalá la pubkey en el server (1 vez, password root).
```

⚠️ **Si SSH/HTTP a `72.60.212.232` da timeout**: el upstream de Hostinger a veces filtra rangos de Azure (de donde sale Codespace). Verificá la IP de egreso con `curl https://api.ipify.org`. Si está bloqueada, no hay forma de destrabarlo desde nuestro lado — hay que pedirle al usuario que abra terminal en su Mac y corra los comandos como relay. Esto pasó en la sesión inicial de la migración.

## API de Dokploy

Dokploy expone REST + tRPC en `https://vpsdokploy.futuradigital.es/api/...`. Auth con header `x-api-key: <token>` (NO `Authorization: Bearer`).

Token API ya generado y guardado por el usuario. **No está en este repo y no debe estarlo**: este repositorio es público, así que escribirlo aquí sería publicarlo. Pedirlo cuando haga falta.

IDs de aplicación: `cliniq-web` = `haWRYSRoJ65pdbPLKzfnJ`, `cliniq-worker` = `d74nHjRGQsplPqFALx-RP`.
Para diagnosticar despliegues sin entrar a la interfaz, `deployment.all?applicationId=…`
devuelve el estado y la duración de cada intento — un fallo de 0,3 s es de
clonado, uno de varios minutos es del build.

Endpoints útiles:
- `POST /api/project.create` — crear project
- `POST /api/postgres.create`, `redis.create`, `application.create`
- `POST /api/application.saveDockerProvider` — config Docker (requiere `username`, `password`, `registryUrl`, todos pueden ser `null`)
- `POST /api/application.saveEnvironment` — env + buildArgs (requiere `buildArgs`, `buildSecrets`, `createEnvFile` aunque sean null/default)
- `POST /api/application.update` — buildType, dockerfile, sourceType, customGitUrl, etc.
- `POST /api/mounts.create` — volumes (campo es `serviceId` y `serviceType`, no `applicationId`)
- `POST /api/domain.create` — Traefik domains
- `POST /api/application.deploy`, `postgres.deploy`, `redis.deploy` — trigger deploy
- `GET /api/project.one?projectId=X` — REST style query string, NO `?input={...}` JSON
- `GET /api/application.one?applicationId=X` — idem REST

## Migración de datos (clean-start)

La migración a Dokploy fue **clean-start** — no se trajeron datos de Supabase. Las 10 migraciones SQL (`supabase/migrations/0000_init.sql` a `0009_*.sql`) más `0010_telephony_zadarma.sql` se aplicaron al Postgres nuevo. Tenants se re-onboardean.

Scripts de migración (`scripts/migrate/`) existen por si en el futuro se necesita: pg_dump Supabase → restore + copia storage. **No probados con datos reales**.

## Telefonía: 3 paths de outbound

`lib/calls/trigger-callback.ts` ramifica según `tenant_telephony.provider`:

1. **Twilio BYOT** — `provider='twilio'`. Usa `Retell.createPhoneCall` con `phoneNumbers` table + caller_id verified.
2. **Zadarma vía Retell SIP trunk** — `provider='zadarma'` AND `inbound_number_e164` set. **Preferido**. Llama a `Retell.createPhoneCall` con `from_number = inbound_number_e164`. Retell rutea por el SIP trunk Zadarma que el operador cargó en Retell dashboard. No requiere SIP interno ni "External SIP" en cabinet.
3. **Zadarma callback API** (legacy) — `provider='zadarma'` sin inbound number. Usa `/v1/request/callback/` de Zadarma. Requiere SIP interno + External SIP a Retell + env `ZADARMA_SIP_INTERNAL_FOR_AGENT`. Solo si path 2 no aplica.

## Telefonía: inbound

Zadarma webhook se configura **manualmente en cabinet** (no expone API). Cabinet → Configuración → Integraciones → Notificaciones de eventos. URL: `https://app.futuradigital.es/api/zadarma/webhook`. Soporta el handshake `zd_echo`. El path está exentido del Clerk middleware (`/api/zadarma/(.*)` es ruta pública).

## Sistema de diseño "Aurora" (UI)

Todo el front comparte un único lenguaje visual. **No inventes estilos nuevos: usá las primitivas.**

**Tokens** (`apps/web/app/globals.css`, bloque `@theme`): canvas pastel (`--color-canvas` #f6f5fb), superficies blancas, escala de marca violeta `brand-50…900`, acentos `grape/blossom/mint/sky/honey/coral`, radios (`22px` tarjeta, `14px` campo, pill), sombras difusas (`--shadow-soft/lifted/float/glow`) y ~20 keyframes (`fade-up`, `pop`, `sheen`, `drift`, `draw`, `shimmer`, `grow-x/y`, `wave`…) expuestos como utilidades `animate-*`.

**Utilidades propias**: `.aurora-canvas` (fondo con auroras animadas), `.glass`, `.hover-lift`, `.press`, `.sheen`, `.spotlight`, `.text-gradient`, `.stagger` (+ `--i` inline), `.bar-fill`, `.skeleton`, `.equalizer`, `.gradient-ring`.

**Primitivas** (`apps/web/components/ui/`):
- `button.tsx` — variantes `primary` (gradiente + barrido), `secondary`, `soft`, `ghost`, `outline`, `danger`, `success`, `glass`, `link`; + `IconButton`.
- `card.tsx` — `Card` con `tone` (`default`, `glass`, pasteles, `night`) e `interactive`; `CardTopbar` (icono en chip + título + acción) unifica las cabeceras.
- `badge.tsx` — `Badge`, `Tag` (estilo `#etiqueta`, color estable por hash), `StatusDot`.
- `input.tsx` — `Input`, `Textarea`, `Select`, `Label`, `InputWithIcon`, `Switch`.
- `tabs.tsx` — pestañas con píldora en gradiente; `SegmentedNav` para tabs por URL.
- `table.tsx` — `TableWrap/Table/THead/HeadRow/TH/TR/TD`.
- `motion.tsx` — `Reveal`, `Stagger`, `Spotlight`, `AnimatedNumber` (IntersectionObserver, sin dependencias).
- `stat.tsx` — `StatTile` (KPI animado), `Sparkline`, `ProgressBar/Dots/Ring`, `Avatar`, `AvatarStack`, `Equalizer`.
- `feedback.tsx` — `EmptyState`, `Skeleton`, `SkeletonRows`, `Callout`, `SectionTitle`.

**Reglas**:
- Sin dependencias de animación (nada de framer-motion): CSS + IntersectionObserver.
- `prefers-reduced-motion` desactiva todo el movimiento (ya está en globals.css).
- Las reglas de `[data-reveal]` viven bajo `html.js`; la clase la pone un script inline del layout raíz para que sin JS el contenido igual se vea.
- La app es **light-only** a propósito: no hay toggle de tema ni variantes `dark:`.
- Toda página del panel usa `PageHeader` (con `eyebrow` + `icon`) y envuelve su contenido en `Card`/`CardTopbar`.

## Módulo Tareas (core, sin gate de `enabled_modules`)

Sección `/dashboard/tasks` (label "Tareas"). Es transversal: no se contrata, viene con todas las clínicas.

**Migración**: `supabase/migrations/0018_tasks.sql`. Tablas `tasks`, `task_assignees`, `task_checklist_items`, `task_comments`, `task_templates`, `task_template_items`, `task_automation_rules` + columnas `treatments.post_op_follow_up{,_hours}`.

**Tres orígenes de tarea** (`tasks.source`):

| source | Quién la crea | Dónde vive la lógica |
|---|---|---|
| `MANUAL` | Una persona desde el tablero | `lib/tasks/service.ts` |
| `ROUTINE` | Plantilla recurrente materializada por el worker | `lib/tasks/templates.ts` (catálogo) + `lib/tasks/materialize.ts` |
| `AUTOMATION` | Regla que reacciona a un evento del producto | `lib/tasks/automation.ts` + `lib/tasks/hooks.ts` |

**Dos altas manuales**: el alta rápida de una línea (`QuickAdd`, con parser `#cat !prio @user` + fecha en `lib/tasks/quick-parse.ts`) para lo urgente, y el **alta completa** (`components/tasks/TaskComposer.tsx`) para el resto: descripción, checklist, varios responsables, etiquetas, vencimiento con hora/todo-el-día, paciente vinculado y candado de evidencia. El composer no necesitó backend nuevo: `createTaskSchema` y `createTask` ya aceptaban todos esos campos; solo faltaba exponerlos. Se abre desde "Nueva tarea" y desde el "Más opciones" del alta rápida (que arrastra lo ya escrito).

**Idempotencia**: `tasks.dedupe_key` con índice único parcial por tenant. Rutinas usan `routine:<templateId>:<YYYY-MM-DD>`, automatizaciones `auto:<trigger>:<entidad>`. Cualquier reintento de webhook o job es seguro.

**Constructor de automatizaciones** (migración `0024_task_automation_builder.sql`): además del catálogo de 10 reglas de sistema (una por evento, `is_system=true`, no se borran, solo se afinan o apagan), un admin puede **crear reglas a medida** sobre los mismos eventos, con **condiciones** (filtros `campo/operador/valor` que decide `evaluateConditions`) y su propia checklist. Claves:
- El único `(tenant_id, trigger)` se cambió por un **único parcial `WHERE is_system`**: como mucho una regla de sistema por evento (la que siembra `ensureAutomationRules` y la que leen los barridos para sus params), pero varias a medida.
- `runTaskAutomation` recorre **todas** las reglas activas del evento cuyas condiciones se cumplen y cada una crea su tarea. El `dedupe_key` de la de sistema conserva el formato histórico `auto:<trigger>:<suffix>`; las de a medida meten su id: `auto:<trigger>:<ruleId>:<suffix>`. Eso mantiene la retrocompatibilidad (es un invariante testeado) y evita que dos reglas del mismo evento se pisen.
- API: `POST /api/tasks/automations` (alta), `DELETE /api/tasks/automations/:id` (baja, rechaza las de sistema), `PATCH` (edición). UI en `components/tasks/AutomationBuilder.tsx`.

**Puntos de enganche** (todos best-effort, nunca rompen el flujo principal — están en `lib/tasks/hooks.ts`):

- `worker/jobs/process-call.ts` → `MISSED_CALL` / `CALL_INTENT_UNRESOLVED`
- `app/api/webhooks/ghl/appointment/route.ts` → `APPOINTMENT_CANCELLED` / `APPOINTMENT_NO_SHOW` / `POST_TREATMENT_FOLLOWUP`
- `worker/jobs/reminder-fallback-check.ts` → `REMINDER_NO_RESPONSE`
- `worker/jobs/whatsapp-process.ts` (handoff del agente) → `WHATSAPP_HANDOFF`
- `lib/waitlist/engine.ts` (`book_failed`) → `WAITLIST_ACCEPTED_UNSCHEDULED`
- Barrido diario → `PENDING_TREATMENT_UNSCHEDULED` / `PATIENT_INACTIVE`

**Crons**: `scheduleTaskCrons()` en `lib/queue/client.ts`, registrada por `worker/index.ts` al arrancar (repeatable BullMQ con `jobId` fijo, idempotente). `task-routines-tick` cada 15 min, `task-daily-sweep` diario 06:10 UTC. No hay cron del sistema ni contenedor extra.

**Timezone**: las rutinas se materializan en la timezone de `clinic_settings.timezone` (helpers puros en `lib/tasks/tz.ts`, recurrencia en `lib/tasks/recurrence.ts`). Ambos con tests unitarios.

**Evidencia**: `tasks.requires_evidence` bloquea el pase a `DONE` sin `evidence_note` en las **tres** vías de escritura: alta (`createTask`), edición (`updateTask`) y arrastre (`reorderColumn`). El flag se lee siempre de la fila guardada, nunca del body — mandarlo en el PATCH que cierra la tarea desactivaba el candado. Es lo que sostiene el registro de esterilización, el arqueo y las revisiones legales.

**Roles**: `viewer` mira, `operator` crea/mueve/cierra, `admin` toca rutinas y automatizaciones (`lib/tasks/auth.ts`).

**Auto-provisión**: la primera visita a la página siembra el catálogo de 16 rutinas dentales, las reglas de automatización y materializa lo del día. Idempotente.

## Módulo Agenda (core, sin gate de `enabled_modules`)

Sección `/dashboard/agenda` (label "Agenda"). La agenda de los profesionales
pasa a ser de la plataforma: hasta aquí vivía en GoHighLevel y el panel sólo
leía una réplica (`appointments_cache`).

**Migración**: `supabase/migrations/0026_agenda_profesionales.sql`. Tablas
`professionals`, `professional_treatments`, `professional_shifts`,
`professional_time_off`, `agenda_appointments` y `clinical_notes`.

**La duración la pone el tratamiento; la rejilla, sólo dónde empieza la cita.**
`professionals.slot_granularity_minutes` es NULL por defecto (migración 0027) y
eso significa *automático*: el paso es la duración de la cita, así que el día se
encadena solo (con 45 min: 9:00, 9:45, 10:30…). Un valor explícito (15, 20, 30,
60) sólo sirve para lo único que aportaba: encajar citas cortas en los ratos que
dejan las largas, a costa de ofrecer el doble de opciones por teléfono. El
descanso entre citas (`buffer_minutes`) es cosa aparte y **0 es válido y es el
defecto**: una cita pegada a la siguiente.

**Convenciones que no se negocian**:
- Días de la semana **ISO** (1 = lunes … 7 = domingo), igual que `lib/tasks/tz.ts`.
- El horario de trabajo son **minutos desde medianoche en hora local** de la
  clínica (`start_minute`/`end_minute`): "los martes de 9 a 14" es una hora de
  pared y tiene que seguir siendo las 9 después del cambio de horario. Las citas
  y los bloqueos sí son instantes (`timestamptz`).
- El panel manda **día + minuto locales**, no un instante: convierte el servidor
  con la timezone de la clínica (`resolveStart` en `lib/agenda/service.ts`). Si
  convirtiera el navegador, quien agenda desde otra zona crearía la cita corrida.

**Piezas**:

| Fichero | Qué resuelve |
|---|---|
| `lib/agenda/availability.ts` | Motor de huecos. Puro: franjas + citas + bloqueos + rejilla, colchón, antelación mínima/máxima. Con tests unitarios (DST incluido). |
| `lib/agenda/queries.ts` | Lecturas: profesionales, calendario por rango, disponibilidad, pacientes y ficha. |
| `lib/agenda/service.ts` | Escrituras con validación: alta de profesional, horario, bloqueos, citas, notas. |
| `lib/agenda/auth.ts` + `access.ts` | Quién puede qué. `access.ts` va aparte para que `lib/tasks/auth.ts` lo use sin ciclo. |
| `lib/agenda/agent.ts` + `voice.ts` | Lo que ven y hacen los agentes virtuales. |
| `lib/agenda/view.ts` | Modelo de vista del calendario (el servidor sitúa cada cita en su día y minuto locales). |

**Alta del profesional: asistente por pasos** (`components/agenda/professional-dialog.tsx`).
Cinco pantallas cortas en vez de un formulario de dieciséis campos con scroll:
quién · acceso · qué hace · horario · huecos. Al **editar** sólo salen tres
(quién, acceso, huecos): los tratamientos y el horario tienen su propio editor
en la ficha, y repetirlos daría dos sitios donde cambiar lo mismo.
- **Del equipo, no a mano**: un desplegable trae a los miembros del panel con
  nombre, email y teléfono (`lib/agenda/team.ts`, que cruza Clerk con la app).
  Elegir a alguien rellena la ficha *y* vincula su usuario — que es lo que hace
  que luego vea su propia agenda. A quien ya es profesional se le marca y no se
  puede elegir dos veces.
- **Tratamientos desde el propio modal**: se marcan los del catálogo y, si la
  clínica no tiene ninguno, se dan de alta ahí mismo con su duración
  (`createTreatmentQuickAction`). Quedan en el catálogo de la clínica, así que
  los agentes virtuales pasan a conocerlos.
- El profesional se crea primero y después se le aplican tratamientos y
  horario. Si algo de eso falla no se tira el alta: se avisa de qué quedó
  pendiente para rematarlo en su ficha.

**Quitar a un profesional** (`deleteProfessional` / `previewProfessionalDeletion`):
`agenda_appointments` y `clinical_notes` cuelgan con ON DELETE CASCADE, así que
borrar a alguien con historial se llevaría por delante la historia clínica de
sus pacientes. Por eso el diálogo pregunta primero qué arrastra:
- Sin citas ni notas (un alta equivocada) → se borra y no queda rastro.
- Con historia → **baja lógica**: desaparece del calendario y de lo que ofrecen
  los agentes, su historia sigue en la ficha de cada paciente, y se puede
  reactivar. El borrado duro se rechaza en el servicio, no sólo en la UI.

**Roles**:
- `admin` de la clínica y Futura: configuran profesionales, horarios,
  tratamientos y bloqueos. Futura entra impersonando y `getCurrentTenant` ya
  devuelve la clínica gestionada, así que puede tocar la agenda de cualquiera.
- `operator` (recepción): ve todas las agendas y crea/mueve/cancela citas.
- `viewer`: mira.
- **Profesional con `panel_access = 'AGENDA_ONLY'`**: su agenda, sus pacientes y
  sus notas. Nada más. El cierre es de servidor en tres capas: el layout del
  panel redirige a `/dashboard/agenda` (el pathname llega por la cabecera
  `x-pathname` que pone el middleware), `requireTaskRole` rechaza cualquier
  escritura del resto del panel, y las acciones de agenda comprueban que el
  profesional es suyo (`assertProfessionalInScope`).

**El rol sale de Clerk cuando no hay fila local.** `tenant_memberships` es una
caché que llena un webhook; si ese webhook no corrió, el administrador quedaba
degradado a operador y no podía ni abrir la configuración de su propia agenda.

**Solapamiento**: cada escritura de cita toma un `pg_advisory_xact_lock` por
profesional. Sin él, la recepcionista y el agente de voz leen la agenda libre a
la vez y el paciente se encuentra a otro en el sillón.

**Los agentes virtuales ven la agenda.** `lib/retell/tools.ts` (voz, saliente y
WhatsApp comparten dispatcher) consulta primero la agenda interna y sólo cae a
GoHighLevel si la clínica no tiene ningún profesional con la agenda encendida:
`agendaCheckAvailability`/`agendaBookAppointment` devuelven `null` y el flujo de
siempre continúa. Novedades para el agente: `list_professionals`,
`professional_name` en `check_availability` y `professional_id` en
`book_appointment` (lo devuelve `check_availability` entre corchetes, igual que
el `start_time`). El prompt de WhatsApp y las variables de Retell incluyen la
lista de profesionales (`{{professionals}}`); si la clínica no usa la agenda
interna va vacía, para que el agente no se invente nombres.

**Las tools de Retell NO están en este repo: viven en el LLM de cada agente,
dentro de Retell.** Que la app sepa responder `list_professionals` no sirve de
nada si el LLM no la tiene declarada — nunca la va a llamar. Por eso hay un
script que las reconcilia contra la API de Retell:

```
tsx --import ./worker/preload.ts scripts/retell/sync-agenda-tools.ts          # aplica
tsx --import ./worker/preload.ts scripts/retell/sync-agenda-tools.ts --check  # sólo comprueba (código 1 si falta algo)
```

Es idempotente y hay que volver a correrlo **cada vez que se da de alta una
clínica con agente propio**. Resuelve los LLM por tres vías: `retell_llm_id` de
`agent_configs`, `retell_agent_id` (preguntándole a Retell cuál es su LLM) y los
agentes por defecto de env (`RETELL_DEFAULT_AGENT_ID`,
`RETELL_OUTBOUND_DEFAULT_AGENT_ID`, `FUTURA_DEMO_RETELL_AGENT_ID`).

⚠️ **Hoy (2026-09-08) ninguna clínica tiene agente propio en la base**: las filas
de `agent_configs` no traen `retell_agent_id` ni `retell_llm_id`, así que todas
caen a los agentes por defecto de env y en producción sólo hay **dos** LLM
atendiendo a todo el mundo (`llm_daa9e8aee1f24a30f0bfff908ed9` para el inbound y
el outbound por defecto, `llm_340dc20dc9c2dd9ec11273b5a430` para la demo). Los
dos quedaron sincronizados. Si el script te dice que revisó dos LLM y no tres o
diez, no está roto: es que sigue sin haber agentes por clínica.

Las variables de los agentes por defecto (`RETELL_*_AGENT_ID`) están sólo en el
env de `cliniq-web`, no en el del worker, así que correr el script dentro del
contenedor del worker sin pasárselas revisa únicamente los agentes que sí estén
en la base.

**Idempotencia**: `agenda_appointments.dedupe_key` con único parcial por tenant.
La voz usa `call:<retellCallId>:<start>` y WhatsApp `wa:<conversationId>:<start>`,
así que un reintento de webhook no deja dos citas.

**Historia clínica**: `clinical_notes`, atada a la cita cuando la hay y siempre
al paciente (`patient_key`: id del CRM, o teléfono normalizado, o email). Una
nota marcada como privada no la ven ni el resto del equipo ni los agentes.

**Bloqueos**: un bloqueo NO cancela las citas que caigan dentro; se avisa de
cuántas hay para que la clínica decida a quién llama.

## Banco de pruebas de los asistentes

`/dashboard/agent` ("Probar el asistente"), con una pestaña por canal
(`?canal=entrante|saliente|whatsapp`). Se prueba lo que atiende al paciente, no
una maqueta.

- **Entrantes** y **salientes** son llamadas web (WebRTC) contra Retell. Van
  separadas a propósito: **son agentes distintos y prompts distintos**
  (`resolveRetellAgentId(tenantId, role)`), así que probar el entrante no dice
  nada del saliente. El saliente además pide el nombre del paciente, que es el
  `{{patient_name}}` de su saludo, y le pasa `use_case`/`campaign_name`: sin eso
  arranca sin saber a qué llama.
- **WhatsApp** llama a `runWhatsappAgent`, el MISMO orquestador que atiende a los
  pacientes: mismo prompt, mismo modelo y las mismas tools. El orquestador no
  escribe en la base (de eso se encarga el job), así que la prueba no deja runs
  ni mensajes; las **tools sí son reales** y una cita reservada en la prueba
  queda en la agenda. La conversación simulada lleva `conversationId` con
  prefijo `sim-` para que su `dedupe_key` nunca choque con una real.
- La respuesta muestra la **traza**: intent y confianza, si deriva a una
  persona, y qué consultó antes de contestar. Es lo que distingue "acertó" de
  "se lo inventó".
- Los dos endpoints (`/api/retell/web-call`, `/api/agent/whatsapp-test`) exigen
  rol `operator`: cada prueba gasta minutos de Retell o tokens del LLM.

## Marca por clínica (white-label)

Futura (super-admin) le puede poner a cada clínica **su nombre y su logo**, y esa
clínica ve esa marca en todo el panel. Se gestiona desde `/dashboard/futura`, en
el botón **Marca** de cada ficha.

**Migración**: `supabase/migrations/0025_tenant_branding.sql`. Columnas
`tenants.logo_url` (lo que se pinta) y `tenants.logo_path` (la key en el bucket,
necesaria para borrar el objeto anterior al reemplazarlo — sin ella cada cambio
de logo deja un huérfano público para siempre).

**Quién puede**: sólo `isSuperAdmin` (miembro del tenant de Futura). La clínica
no toca su propia marca. El gate se comprueba en el servidor en las tres vías:
`renameClinicAction`, `removeClinicLogoAction` y `POST /api/futura/branding/logo`.

**El logo lo persiste el servidor, no el cliente.** El endpoint sube el archivo
*y* escribe `logo_url`/`logo_path`; no devuelve la URL para que el navegador la
mande en un guardado aparte. Si lo hiciera, cualquiera con sesión podría escribir
una URL arbitraria en `logo_url` y el panel la pintaría.

**Nada de SVG** (`lib/branding.ts`): es HTML ejecutable y el logo se sirve desde
un bucket público y se pinta dentro del panel. Allowlist: PNG, JPG, WEBP, AVIF,
GIF, hasta 2 MB.

**La key lleva un UUID**, no un nombre fijo por clínica: los objetos se sirven con
`Cache-Control: max-age=3600`, así que reescribir la misma key dejaría el logo
viejo en el navegador hasta una hora después del cambio.

**El nombre se escribe en los dos sitios**: `tenants.name` y la organización de
Clerk (que es lo que dibuja el `OrganizationSwitcher` del sidebar). Primero la
base, después Clerk; si Clerk falla el cambio no se pierde y la acción devuelve
`warning` en vez de `error` — decir "error" ahí haría que se reintentara un
cambio que ya está hecho.

**Sin logo propio se dibuja la marca FUTURA**, no el nombre de la clínica: el
producto sigue siendo Futura y el nombre ya se lee justo debajo, en el selector
de organizaciones. Al cambiar la marca hay que invalidar el **layout**
(`revalidatePath('/dashboard', 'layout')`), no sólo la página: el sidebar y el
topbar viven ahí.

## Módulo Mensajes (core, sin gate de `enabled_modules`)

Sección `/dashboard/messages` (label "Mensajes"). Chat interno del equipo. Transversal, como Tareas.

**Migración**: `supabase/migrations/0019_internal_messaging.sql`. Tablas `im_channels`, `im_channel_members`, `im_messages`, `im_message_reactions`, `im_mentions`, `im_saved_messages`, `im_pins`, `im_user_settings` + columnas `tasks.im_channel_id/im_message_id`.

**Tiempo real**: SSE multiplexado, **una conexión por usuario** (`/api/messages/stream`), no una por canal. Fan-out en la escritura a `im:user:<id>` por Redis pub/sub. El hub (`lib/realtime/hub.ts`) mantiene **un solo subscriber ioredis por proceso** con refcount y rehace las suscripciones en el evento `ready` — Redis las pierde al reconectar, y sin eso un redeploy deja todas las SSE mudas. `MessagingProvider` (montado en el layout) es el dueño único del `EventSource`; `useMessagingStream` delega en él cuando está montado.

**Estado efímero en Redis, durable en Postgres**: typing (`SETEX` 6 s) y presencia (`SETEX` 45 s, refrescada por el propio SSE cada 20 s) no tocan la BD. Los contadores de no leídos están desnormalizados en `im_channel_members` porque el sidebar se renderiza en cada navegación.

**Integraciones** (`lib/messaging/bot.ts` → `postSystemEvent`, best-effort e idempotente por `dedupeKey`, nunca lanza):

| Origen | Evento |
|---|---|
| `worker/jobs/process-call.ts` | `call.missed`, `call.transferred_unanswered` |
| `worker/jobs/whatsapp-process.ts` | `wa.handoff` |
| `worker/jobs/reminder-fallback-check.ts` | `reminder.no_response` |
| `worker/jobs/task-daily-sweep.ts` | `task.overdue_digest` |
| `lib/waitlist/engine.ts` | `waitlist.slot_open`, `waitlist.book_failed` |
| `app/api/webhooks/ghl/appointment/route.ts` | `appointment.cancelled`, `appointment.no_show` |
| `lib/tasks/service.ts` | `task.assigned` + espejo de comentarios al hilo |

**Crons**: `scheduleMessagingCrons()` en `lib/queue/client.ts`. `im-digest` cada 30 min (publica solo a las 08:00 de la timezone de cada clínica), `im-retention-sweep` diario 04:40 UTC. `im-mention-escalate` es delayed, apagado por defecto.

**Adjuntos**: bucket privado `S3_BUCKET_INTERNAL`. La URL se firma **en cada lectura** (`GET /api/messages/attachments?key=`), nunca se guarda firmada en el mensaje: caducaría y los adjuntos morirían en silencio.

**RGPD**: retención configurable (defecto 24 meses, gana el mínimo del tenant), `exportMessagesForPatient()` para el derecho de acceso, y las notificaciones de escritorio nunca llevan datos de paciente.

**Degradación**: si la migración no está aplicada, el badge del sidebar cae a 0 y `/dashboard/messages` muestra el rail vacío. Nada fuera del módulo se rompe.

## Idioma

Comentarios de código, commit messages y mensajes UI: **español**. (Existing code convention.) PR descriptions y CLAUDE.md pueden ir en español o inglés, lo que sea más claro.

## Cómo testear builds antes de pushear

```bash
pnpm --filter web typecheck         # rápido
pnpm --filter web test              # vitest (unitarios; incluye los de componentes .tsx)
pnpm --filter web test:integration  # módulo Tareas contra un Postgres real (ver vitest.integration.config.ts)
pnpm --filter web build             # standalone build; necesita env vars con shape Clerk válido
```

## Branches & PRs

- `main` es la rama productiva. Dokploy auto-deploya desde main.
- Feature branches con prefijo `feat/`, `fix/`, `refactor/` según convenciones de commit (`feat:`, `fix:`, `refactor:`, `chore:`).
- Co-author footer en commits generados por Claude: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

## Pendientes operativos conocidos (snapshot)

Estos quedan como TODO para futuras sesiones:

1. Reapuntar webhook **Twilio WhatsApp** del número productivo a `https://app.futuradigital.es/api/webhooks/whatsapp/twilio` (Twilio Console → Phone Numbers → Messaging URL).
2. Reapuntar webhook **Retell** a `https://app.futuradigital.es/api/webhooks/retell` + conseguir + setear `RETELL_WEBHOOK_SIGNING_KEY` en env.
3. Pasar Clerk de **test keys** a **production keys** cuando se acerque el cutover real.
4. Borrar org **huérfana** `org_3DPj5m8J9lGStm3zXUpQzKBWdFd` en Clerk (creada pre-fix del webhook; no tiene tenant en BD).
5. Verificar bug del agente outbound — primera prueba devolvió `dial_no_answer` con `duration_ms=0`; sospecha saldo Zadarma bajo o país de destino no habilitado. Verificar saldo + historial Zadarma cabinet.
6. ⚠️ **Repegar las URLs de los webhooks de GHL con su token.** Los webhooks de GoHighLevel ahora exigen un token por tenant y rechazan con 401 sin él. Al primer intento fallido, el contenedor loguea la URL exacta a configurar (`[ghl-webhook] token inválido o ausente ... Configurá esta URL en GHL: ...`). Va en GHL → Settings → Integrations → Webhooks, para los dos endpoints (`/contact` y `/appointment`).
7. **Reconectar las instancias de Evolution.** El webhook de Evolution también lleva token; se registra solo al crear o reconectar la instancia desde el panel, pero las instancias ya existentes siguen apuntando a la URL vieja y devolverán 401. Reconectarlas desde `/dashboard/whatsapp/integrations`.
8. **Confirmar la persistencia de Redis en Dokploy** (AOF o RDB en `cliniq-redis`). Los `reminder-send` son jobs *delayed* y viven sólo en Redis: sin persistencia, un reinicio los borra. Ya hay una red de seguridad (`reconcileOverdueReminders`, dentro del barrido diario) que re-encola los `SCHEDULED` vencidos, pero es una red, no un sustituto.
9. Rotar `ENCRYPTION_KEY` invalida los tokens de webhook (se derivan de ella) — hay que repetir los pasos 6 y 7 después de rotarla.

## Seguridad: invariantes que no se negocian

Escrito después de una auditoría que encontró varias de estas rotas. Antes de tocar estas zonas, leer esto.

- **Todo webhook público verifica antes de tocar la BD.** Los proveedores que firman (Clerk/svix, Retell, Twilio, Meta Cloud, Zadarma) se validan con su firma; los que no firman (GHL, Evolution) exigen el token por tenant de `lib/webhooks/tenant-token.ts`. Un identificador que manda el propio emisor (`locationId`, `instance`) NO es autenticación: es público o adivinable.
- **La verificación de firma nunca es condicional.** Un `if (signature) { ...verificar... }` se salta omitiendo el campo. Si el tenant tiene secret, la firma es obligatoria.
- **Los gates de rol normalizan antes de comparar.** Clerk guarda `member` / `org:admin`, no nuestros tres roles. Comparar el valor crudo contra la tabla de orden da `undefined < 2` → `false` y deja pasar a cualquiera. Usar siempre `normalizeRole()` de `lib/tasks/auth.ts`.
- **Esconder un botón no protege nada.** Toda ruta y toda Server Action que escriba valida el rol en el servidor (`denyUnlessRole()` de `lib/auth/api-guard.ts`).
- **Toda query lleva `tenant_id` en el `WHERE`**, lecturas y escrituras, incluso cuando el id viene de una fila ya validada. Es defensa en profundidad y además es lo que hace que se usen los índices, que lideran por `tenant_id`.
- **Los ids de usuario que llegan del cliente se validan contra la membresía del tenant** antes de darles acceso a nada (`upsertMembers` en `lib/messaging/channels.ts`). El fan-out de realtime publica a `im:user:<id>` sin tenant en la clave.
- **Los datos de paciente no van a los logs.** Los payloads de webhook se guardan con `redactWebhookPayload()`: la transcripción y la grabación se cifran en `calls`, volcarlas en claro en `webhook_logs` anula ese cifrado.
- **Todo endpoint público que gasta dinero lleva rate-limit por IP y tope global** (`lib/queue/rate-limit.ts`). Un límite por número de teléfono no sirve: se rotan números.

## Colas: invariantes

- **La clave del caché de pasos incluye `job.timestamp`** (`stepScope()`). Varios jobIds son estables por entidad (`rem-send-<reminderId>`), así que sin el timestamp una corrida nueva lee los pasos de la anterior. Ese bug hacía que un recordatorio reagendado no se enviara nunca.
- **Un envío externo y su marca en BD no comparten `step.run`.** Si falla la escritura, el reintento le vuelve a mandar el mensaje al paciente.
- **Un guard de "ya procesado" que lee y después actúa necesita lock** (`acquireLock()` de `lib/queue/lock.ts`) si el efecto ocurre antes de escribir la marca.
- **Toda llamada externa lleva timeout.** BullMQ renueva el lock mientras el handler está vivo, así que un fetch colgado no se marca stalled: inmoviliza el slot para siempre.
- **Los repeatables se registran con `upsertRepeatable()`**, que limpia la programación anterior: la clave de BullMQ deriva del patrón, así que cambiarlo deja la vieja corriendo en paralelo.

## Rendimiento: lo que no hay que volver a romper

- **Nada del panel arranca en `opacity: 0` esperando a la hidratación.** El subárbol del dashboard lleva `data-instant-reveal` y se pinta visible; el reveal por scroll queda para la landing. Ese patrón hacía que el LCP real del panel fuera el fin de la hidratación.
- **Toda ruta del panel tiene `loading.tsx`.** Con rutas `force-dynamic` y sin él, el navegador se queda en la pantalla anterior durante todo el trabajo de servidor.
- **Nada de una query por fila.** El preview del inbox de WhatsApp eran 101 queries por render, refrescadas cada 8 s.
- **Las pestañas que son Server Components se resuelven por URL, no con `TabsContent`**: Radix sólo oculta con CSS, así que se ejecutan y se envían todas.
- **La auto-provisión no bloquea el render** salvo la primera vez; el resto va a `after()` o al cron del worker.
- **`recharts` y todo lo pesado entran por `next/dynamic`** (`components/dashboard/charts-lazy.tsx`).

---

**Última actualización**: 2026-09-01 (auditoría con agentes de verificación: webhooks firmados, gates de rol, idempotencia de colas, migraciones huérfanas recuperadas, índices, carga percibida del panel y CI en verde).
