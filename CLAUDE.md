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

## Deploy: el build vive en GitHub Actions, NO en el VPS

**Para desplegar basta con mergear a `main`.** Lo que pasa después está en
`.github/workflows/ci.yml`: GitHub corre biome + typecheck + vitest, construye
las dos imágenes, las publica en GHCR y llama a la API de Dokploy, que sólo baja
la imagen y reinicia. **Si el CI está en rojo, no se despliega.**

Antes compilaba el propio VPS y cada push costaba **4m23s–7m50s**. El worker,
que no compila nada, tardaba 8 segundos en el mismo circuito: toda la
diferencia era el `next build`, en frío, compitiendo con Postgres, Redis, MinIO
y los dos contenedores de la app en la misma máquina. Los picos de 7–8 min eran
el primer deploy de cada día, cuando la limpieza diaria de Docker ya se había
llevado la capa del `pnpm install`.

Medido en Actions (imagen web): **5m31s** en frío absoluto, **3m35s** con las
capas cacheadas y **3m16s** en régimen. Dentro de eso, el `next build` en sí son
**30 segundos**: el resto es el circuito de Docker —capas, push a GHCR y
guardado de la caché—, que es donde queda margen si algún día vuelve a molestar.
Los tres jobs corren en paralelo, así que el minuto de tests no suma.

- **Imágenes**: `ghcr.io/gabrielspirillo/llamadasalientes/{web,worker}`, tag por
  commit. El paquete es **privado**: Dokploy se autentica con el PAT de
  `GHCR_PULL_TOKEN`, que el workflow reenvía en cada deploy.
- **El worker se despliega ANTES que el web**: aplica las migraciones al
  arrancar, así que el web no puede adelantarse a un esquema que no existe. El
  workflow sondea el estado y aborta si el worker falla.
- **Los secretos del build no van como build-arg**, sino como secretos de
  BuildKit (`--mount=type=secret` en `Dockerfile.web`): un ARG queda en el
  historial de la imagen y esta imagen se publica. Sólo las `NEXT_PUBLIC_*` van
  como build-arg, porque acaban embebidas en el JS del navegador de todos modos.
- **`experimental.cpus` y la optimización de memoria son configurables**
  (`NEXT_BUILD_CPUS`, `NEXT_BUILD_LOW_MEMORY`). Los defaults siguen siendo los
  del VPS (2 cores, sin OOM); el workflow los sube porque el runner está vacío.
- ⚠️ **No volver a poner la Fuente del servicio en Git.** Eso devuelve el build
  al VPS. Los dos servicios están fijados a Imagen Docker, y `autoDeploy` está
  apagado para que el webhook de push no dispare un deploy en paralelo.

Secrets que el workflow necesita (repo → Settings → Secrets and variables →
Actions): `DOKPLOY_API_KEY`, `GHCR_PULL_USER`, `GHCR_PULL_TOKEN`,
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
`CLERK_WEBHOOK_SIGNING_SECRET`, `DATABASE_URL`, `DIRECT_URL`, `ENCRYPTION_KEY`
y, si se usa, `SENTRY_DSN`.

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
| OpenAI     | **Único modelo de la plataforma**: `gpt-5.4` para el asistente de WhatsApp, el entrenador, imágenes y PDF, resúmenes e insights de llamadas; `gpt-4o-transcribe` (caída a `whisper-1`, `OPENAI_TRANSCRIBE_MODEL`) para notas de voz | `OPENAI_API_KEY`. Modelo en `OPENAI_AGENT_MODEL` (`lib/openai/model.ts`). ⚠️ **Gemini se retiró del todo el 6/11/2026** a pedido de la clínica (fallaba al interpretar): no volver a añadirlo ni como respaldo. `GEMINI_*` y `OPENAI_AGENT_FALLBACK_MODEL` ya no se leen. |
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
- ⚠️ **Tailwind 4: una variable CSS en una utilidad va entre paréntesis**,
  `border-(--color-border)`, `ring-(--color-border)`, `bg-(--color-canvas)`.
  La forma de Tailwind 3, `border-[--color-border]`, compila a
  `border-color: --color-border` (inválido), el navegador la descarta y el
  borde cae a `currentColor`: **todas las tarjetas salían con borde negro de
  1px** hasta el 2026-09-23, cuando se reemplazaron 300+ usos. Para un color
  del `@theme` también vale la utilidad directa (`border-border`).
- Sin dependencias de animación (nada de framer-motion): CSS + IntersectionObserver.
- `prefers-reduced-motion` desactiva todo el movimiento (ya está en globals.css).
- Las reglas de `[data-reveal]` viven bajo `html.js`; la clase la pone un script inline del layout raíz para que sin JS el contenido igual se vea.
- La app es **light-only** a propósito: no hay toggle de tema ni variantes `dark:`.
- Toda página del panel usa `PageHeader` (con `eyebrow` + `icon`) y envuelve su contenido en `Card`/`CardTopbar`.

## Liquid Glass (capa de vidrio sobre Aurora, 10/11/2026)

El panel es de vidrio: todo cuelga de la clase **`liquid`** en la raíz del
layout (`app/(dashboard)/layout.tsx`) y de un bloque propio al final de
`globals.css`. **Quitar esa clase devuelve el diseño anterior entero.** No
cambia la distribución: vuelve de vidrio las superficies que ya existían.

- **Ganchos `data-slot`**, no clases nuevas en cada página: `sidebar` (isla
  flotante), `topbar` (cápsula verde intensa), `card` + `data-tone`, `stat`,
  `hero` / `hero-slot` / `hero-side` (bloque «Hoy»), `dialog`; `data-variant`
  en `Button` (botones de cristal: el principal vidrio verde, el resto vidrio
  claro); clases `lg-track` (pestañas) y `lg-field` (campos). Los paneles
  blancos hechos a mano se cogen con una regla general (`bg-white` + borde +
  esquinas grandes dentro de `main`).
- ⚠️ **El fondo de auroras va en el fondo de `.liquid`, repartido en % por toda
  la página, nunca en una capa `position: fixed`.** La primera versión era una
  capa fija del alto de la pantalla: en páginas largas se cortaba y el vidrio
  de las tarjetas enseñaba la línea. Intensidad baja a propósito.
- La cápsula superior flota 12 px más abajo, así que las barras fijas que iban
  a `top-[68px]` bajan a 80 px y son casi opacas: con más transparencia el
  texto de debajo se mezclaba con el de las pestañas al hacer scroll.
- Los modales se pintan fuera del panel: se alcanzan con
  `html:has(.liquid) [data-slot="dialog"]`.
- **Líneas del bloque «Hoy»** (`components/dashboard/hero-lines.tsx`): curvas
  finas con un destello menta que las recorre y deriva lenta, el mismo efecto que el fondo
  del portfolio en los verdes de la marca. Sólo SVG + CSS.
- Todo se apaga con «reducir movimiento» y, la transparencia, con «reducir
  transparencia». Reservar el desenfoque a superficies grandes: nunca a cada
  fila de una tabla.
- ⚠️ **Nunca escribir `-webkit-backdrop-filter` junto a `backdrop-filter`.** El
  minificador de Tailwind 4 (Lightning CSS) se quedaba sólo con la prefijada y
  Chrome no desenfocaba NADA (ni el vidrio ni la vieja `.glass`) hasta el
  10/11/2026. Se escribe sólo la estándar; el prefijo lo pone él.
- ⚠️ **Sin `backdrop-filter` salvo en los modales.** Medido el 10/11/2026 con
  la CPU a 4x: el desenfoque de la cápsula, el sidebar y las barras pegadas
  bajaba el scroll de ~50 a ~20 fotogramas por segundo (Panel, Pacientes,
  Tareas). Sin él, el vidrio rinde igual que el diseño anterior. Lo que flota
  sobre contenido va con relleno opaco o casi (la cápsula, opaca del todo: con
  un 4 % de transparencia se leía el texto de debajo).
- **La franja sobre la cápsula es un elemento propio** (`data-slot="topbar-veil"`
  en `topbar.tsx`): un velo del color del fondo que se desvanece hacia abajo,
  sin borde duro (un color plano que acababa de golpe se leía como un corte).
- **Nada se anima redibujando.** Los pulsos de las líneas del bloque «Hoy»
  animaban `stroke-dashoffset` y costaban ~11 % de CPU en reposo (40 % a 4x)
  sólo por estar en pantalla; ahora son una banda que se mueve con `transform`
  detrás de una máscara con la forma de las líneas (0,5 %). Una animación nueva
  que no sea `transform`/`opacity` hay que medirla (`document.getAnimations()`
  + `Performance.getMetrics` con y sin ella).
- **Los botones necesitan su `:hover` en el bloque de vidrio**: esas reglas van
  fuera de capa y pisan los `hover:` de Tailwind de cada variante.

## Móvil (10/11/2026)

- **Barra de pestañas abajo** (`components/dashboard/mobile-tab-bar.tsx`,
  montada en `topbar.tsx`, `lg:hidden`): Inicio · Agenda · WhatsApp (o Mensajes
  sin el módulo) · Tareas · Más (abre el cajón del menú). Futura en su propia
  organización ve Clínicas · Uso · Asistente · Mensajes · Más. No se pinta para
  el profesional `AGENDA_ONLY`. El `<main>` reserva su alto
  (`pb-[calc(104px+env(safe-area-inset-bottom))]`), y lo que va fijo abajo
  (barra de «cambios sin guardar», avisos del chat, barras `sticky bottom-0`)
  sube por encima en móvil. Un elemento fijo abajo nuevo tiene que hacer lo
  mismo o queda tapado.
- **Tablas en móvil = tarjetas con CSS, sin duplicar la lista** (Agenda →
  Pacientes): `max-md:block` en tabla y cuerpo, cada `TR` en rejilla y las
  columnas secundarias `max-md:hidden`. Duplicar el listado para móvil
  doblaría el HTML de cientos de filas.
- `PageHeader` en móvil: título más bajo, descripción en dos líneas y las
  acciones en una fila que se desliza. Las pestañas que se deslizan se
  difuminan al final sólo si hay scroll (línea de tiempo de scroll en CSS).
- La tira de datos de la ficha no deja celdas grises vacías en móvil
  (`fullWidthOnMobile`, con test).
- La barra de pestañas lleva **Pacientes** (`/dashboard/agenda/pacientes`) en
  lugar de Tareas; Agenda no se enciende dentro de Pacientes (`except`).
- **Chat de WhatsApp en móvil = pantalla completa** (`max-lg:fixed inset-0
  z-50` en `whatsapp/[conversationId]/page.tsx`): sólo se desplazan los
  mensajes, abre en el último, la caja de escribir va fija (una línea, 16 px
  para que iOS no amplíe, envío redondo) y la columna del contacto se abre con
  el botón «i» como hoja (`chat-info.tsx`, hablan por un evento de ventana).
  Urgente y Eliminar pasan a esa hoja; en la cabecera, Atender y Cerrar.
- ⚠️ **`.enter-page` va con `backwards`, no `both`**: con `both` la animación
  seguía aplicada y `<main>` quedaba como capa de apilamiento, así que nada de
  dentro podía ponerse por encima de la barra superior (el chat a pantalla
  completa quedaba debajo).
- **Gestionando una clínica**: el chip es de cristal con el ojo en ámbar
  (antes amarillo macizo sobre el verde) y en móvil ocupa el sitio del logo.
- **Mensajes (chat interno) en móvil**: con un canal abierto, el espacio de
  trabajo pasa a pantalla completa (`MessagesWorkspace`, según `mobilePane`).
- **Agenda en móvil**: barra de control compacta y «Nueva cita» como botón
  flotante. Va FUERA de la `Card`: la animación de entrada de la tarjeta usa
  `transform`, que hace de contenedor de un `fixed` y lo dejaba dentro.
- **Tablas genéricas en móvil**: clase `mobile-cards` en la `<table>` +
  `data-label` en cada celda (primera = quién, sin etiqueta; acciones, sin
  etiqueta). Lista de espera (cola, ofertas, histórico) y Uso por clínica.
- Campos dentro de una caja que ya marca el foco: `data-bare-input` (sin el
  anillo global de `:focus-visible`).

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

**Quitar a un paciente o contacto** (`RemovePatientButton` en Agenda →
Pacientes, en la ficha y en el contacto de WhatsApp; lógica en
`lib/patients/removal.ts`). Sólo admin. Se puede quitar a cualquiera, tenga o
no historia: el diálogo enseña antes lo que se va (citas, notas, cobros,
consentimientos, mensajes) y, con historia, pide escribir BORRAR. Los
recordatorios pendientes de sus citas se cancelan. **Las facturas emitidas no
se borran nunca** (documentos legales numerados): quedan en Finanzas sin
paciente enlazado.

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

## Entrenar al asistente (core, sin gate de `enabled_modules`)

Sección `/dashboard/entrenamiento` (label "Entrenar asistente", dentro del menú
Clínica). La clínica le enseña a su asistente de WhatsApp **conversando**, no
editando un prompt.

El problema que resuelve: cuando el asistente contestaba mal a un lead, la
clínica no tenía forma de corregirlo. Lo que sabía salía del catálogo de
tratamientos, de las FAQs y del campo `persona` de `whatsapp_agent_settings`
—un textarea suelto que nadie de una clínica iba a rellenar bien—, así que la
corrección llegaba por teléfono y alguien tocaba el prompt a mano.

**Migración**: `0038_entrenamiento_asistente.sql`. Tablas `agent_lessons` (lo
aprendido) y `agent_training_messages` (la conversación con el entrenador, que
se guarda: una clínica entrena en varios ratos, no de una sentada).

**Quien atiende no es el asistente: es un entrenador** (`lib/agent-training/coach.ts`),
un segundo LLM con su propio prompt y UNA sola herramienta,
`proponer_ensenanzas`. Traduce "es que cuando preguntan el precio suelta la
cifra y se nos van" en tarjetas concretas. Claves:
- ⚠️ **Su actitud por defecto es PROPONER, y el prompt lo dice con esas
  palabras.** La primera versión abría con un "NUNCA propongas una enseñanza que
  fije un precio, un horario o una hora libre" y cerraba con un bloque de
  prohibiciones: el modelo generalizó y contestaba "no puedo hacerlo" a casi
  todo, dejando la sección inútil. Ahora el "no puedo" está acotado a tres casos
  (diagnosticar, quitar urgencias o el paso a recepción, mentir al paciente) y lo
  de los datos concretos es un matiz, no una negativa: si le dictan un precio,
  propone igual la enseñanza de CÓMO responder y añade dónde se cambia la cifra.
- **Propone, nunca guarda.** Aplica la persona que está delante, de a una
  tarjeta, y puede editar el texto antes. Un modelo que se auto-aprueba
  instrucciones para otro modelo es la forma más rápida de que el asistente
  acabe diciendo algo que la clínica nunca dijo.
- Conoce el catálogo, las FAQs y lo ya enseñado, y **se niega a fijar precios,
  horarios o huecos** como enseñanza: eso vive en Tratamientos, en Preguntas
  frecuentes y en Datos de la clínica, y cambia. Cuando se lo piden, dice dónde
  se cambia.
- Tampoco propone quitarle el protocolo de urgencias ni el paso a recepción, ni
  que diagnostique.
- El loop es de dos vueltas: el modelo manda la llamada a la herramienta sin
  texto, así que se le devuelve el acuse y se le pide el mensaje para la persona.

**Guiones deterministas del asistente de Respinens** (`messageScripts`,
`lib/care-profile/messages.ts`; se eligen en `runWhatsappAgent` sin pasar por
el modelo): `greeting` (¿es la primera vez?) sale **siempre** que piden cita
sin decir si ya vinieron, también con niños en ficha, salvo que nombren a uno
registrado (`mentionsRegisteredChild`): el 5/11 la madre de un paciente pidió
cita para la hermana y el asistente la trató como conocida. Si la conversación
dice "primera vez" u "otro hermano", `check_availability` va con
`first_visit=true` aunque el modelo no lo pase (`conversationSaysFirstVisit`).
`infoRequest` ("quería informarme sobre las terapias / precios") responde con
el texto de la clínica (web + ofrecer cita): **nunca la lista del catálogo con
precios**; la autorrevisión (`price_list`) rechaza dos o más líneas con €.
Se decide sobre la **última línea** de la ráfaga (`lastUserLine`) y nunca si
el mensaje pide aviso, cancelar, cambiar o confirmar: el 6/11 "¿me avisáis si
se libera?" cayó al guion de la web por el "precio" del mensaje anterior.
**Hermano nuevo**: un niño dado de alta por el asistente en un teléfono que ya
tiene otro niño en ficha, o cuando la familia dice que es hermano
(`conversationSaysSibling` → `sibling_of_patient`), nace con
`sibling_mark = SIBLING` ("1ª visita (H)"): el cálculo por familia necesita
citas del hermano en la plataforma y con la historia de papel salía "1ª
visita" a secas. **El tratamiento del hermano lo elige la app**
(`pickTreatmentForChild`, `lib/agenda/treatment-pick.ts`, puro con tests):
sin historia y con un hermano que ya vino (o marca H) va la primera visita
DE HERMANO ("HERMANO PEQUEÑO - PRIMERA VISITA", que Respinens cobra distinto);
la `0065` la marcó `FIRST` porque sin `visit_kind` el asistente nunca la
elegía y reservaba la normal. **La fecha de nacimiento que escribió la familia manda**
(`birthDateFromTexts`: "15 de julio de 2026", "15/07/26"): se sobreescribe la
del modelo antes de `register_patient`; sin año en el texto sigue
rechazándose (`birthYearSaid`). **Días cerrados**: el prompt lista los días en
que la clínica no abre (`closedDaysLabel` de `clinic_settings.working_hours`,
var `closed_days_text`) y `check_availability` contesta "la clínica no abre
los sábados" en vez de "no me queda nada" (`closedWeekdays` en
`findAgentSlots`). **Hueco ocupado mientras contestaban**: `book_appointment`
lo dice ("se ha ocupado mientras tanto, hay mucha demanda") y la regla 9 del
prompt prohíbe "tienes razón"/"perdona". **Antes de decir eso se mira si la hora
ya es SUYA** (misma ficha o teléfono, mismo profesional): el 6/11 el modelo
repitió la reserva con otro formato de `start_time`, la clave de idempotencia
no coincidió y le dijo a la familia que su propia cita "se había ocupado".
**Envío duplicado en reintentos**: `send-outbound` no manda un saliente
idéntico a uno ya guardado desde que empezó la ráfaga (ese día una lista de
huecos llegó dos veces, la segunda después de reservar, y la familia volvió a
elegir). El aviso de fiebre (‼️) va sólo en la bienvenida, no pegado a cada
respuesta. **Presentación**: al primer mensaje la app pone "Hola😊, soy …" y quita el
saludo del modelo con `dropLeadingGreeting` (sólo la palabra, un nombre detrás
y sus signos; antes se comía hasta 20 caracteres: "Uedo ayudar?"). El guion
"¿es la primera vez?" no sale si el mensaje habla de una cita que ya tiene
(anular, cambiar, confirmar, "la cita que tengo"). **Respuestas al recordatorio del
día**: `parseDayOfTextReply` entiende "1. Confirmamos", "2 cambiar" y
"confirmamos".

**Autorrevisión añadida el 10/11** (`reviewFinalText`): `apology` ("tienes
razón", "perdona", "disculpa", "me he equivocado"), `search_not_done` (dijeron
"sí" a "¿te miro huecos?" y no se llamó a `check_availability`) y
`repeated_question` (la misma pregunta que en uno de los tres últimos
mensajes). **Nombre completo**: si la familia escribió tres palabras o más y
el modelo las partió dejando un solo apellido ("Lucas Andreev" +
"Petrov"), `fullNameWrittenByFamily` pasa `only_one_surname` y no se vuelve
a pedir el "segundo apellido".

**Auditoría del prompt (6/11/2026)**, lo que se corrigió y hay que mantener:
- **Todo en tú, nunca en vos.** El prompt y los resultados de las herramientas
  llevaban voseo ("usá", "tenés", "decí", "Llamá") mientras una regla decía
  "nunca uses vos": el modelo copia lo que lee. Un texto nuevo para el modelo
  va en tú (`lib/retell/tools.ts`, `lib/agenda/voice.ts`, `lib/care-profile/agent.ts`).
- **La sección "TU FUNCIÓN" manda sobre todo lo anterior**
  (`buildRoleSection`): cualquier regla que importe de verdad tiene que estar
  AHÍ, no sólo arriba. Por eso ahí viven también: día cerrado = "no abrimos"
  (no "no me queda nada"), hueco ocupado = explicarlo sin "tienes razón", y
  cancelar sólo si lo dicen claramente ("ese día no puedo" es cambiar).
- Regla 10 del prompt base: nunca mover ni cancelar una cita por iniciativa
  propia; `confirm_appointment` y `request_earlier_appointment` están en la
  lista "Cuándo usar cada herramienta" (antes sólo en la descripción).
- El horario de atención va en cifras (`working_hours_plain`, "lunes
  15:00-20:30"); el de palabras (`working_hours_text`) es para la voz.
- Las versiones "administrativas" de las reglas 5 y 6 las aplica
  `stripClinicalTriage` con regex sobre el texto base: si se cambia una frase
  del prompt base hay que cambiar también su regex, o la clínica pediátrica se
  queda con la regla dental.
- ⚠️ Lo que el repo NO controla y puede hacer delirar al asistente: FAQs y
  tratamientos cargados en la clínica (en QA había FAQs dentales con otra
  dirección), las enseñanzas de "Entrenar asistente" (van al final y mandan) y
  el prompt de los agentes de voz, que vive en Retell.

**Dónde entra lo aprendido**: `formatLessonsForPrompt` (puro, en
`lib/agent-training/model.ts`, con tests) arma una sección que
`loadGroundingForTenant` carga y `buildSystemPrompt` inyecta en los DOS prompts
(BOOKING y DERIVE). ⚠️ **Va AL FINAL del prompt, no arriba.** Puesta después de
la personalización —donde estaba el primer día— quedaba por delante de
cuatrocientas líneas de reglas y guiones, y el modelo se quedaba con el guion:
una clínica le enseñó "pregunta con quién hablo al saludar" y el asistente
siguió soltando literalmente el saludo de ejemplo de la Regla 0. Y el texto de
la sección dice lo contrario de lo que decía: **manda sobre todo lo anterior**
—el saludo, las frases de ejemplo, el orden de las preguntas, el cierre— y sólo
cede ante tres cosas, los DATOS OFICIALES (que se consultan, no se inventan),
el protocolo de urgencias y el paso a recepción, y no diagnosticar ni prometer.
Sin enseñanzas devuelve cadena vacía, así que una clínica que no entrenó tiene
exactamente el prompt de siempre. Tope de `MAX_LESSONS_IN_PROMPT` (60): cada
enseñanza son tokens en TODAS las ráfagas de TODAS las conversaciones.

⚠️ **Los "retos" recomendados se probaron y se quitaron** (migraciones 0039 y
0040). Eran un tablero al lado de la charla con el nivel del asistente y doce
ajustes de catálogo aplicables con un clic. La clínica los pidió fuera: quiere
la conversación, no un tablero de niveles compitiendo con ella. La 0040 devuelve
la columna `quest_id`; las enseñanzas que hubieran salido de un reto se quedan,
porque son instrucciones válidas. Si vuelve a plantearse, el problema real que
resolvían —la pantalla en blanco— se ataca mejor dentro del propio chat.

**También cambia los DATOS, no sólo la forma de responder** (migración
`0041_entrenamiento_cambios_datos.sql`; lo puro en
`lib/agent-training/data-changes.ts` con tests, lo que escribe en
`lib/agent-training/clinic-data.ts`). Enseñarle a responder no arregla un precio
desactualizado, y contestar "eso se cambia en Registros → Tratamientos" es
mandar a la clínica a otra pantalla a hacer a mano lo que acaba de explicar con
palabras. El entrenador tiene una segunda herramienta,
`proponer_cambios_de_datos`, con la que toca `treatments`, `faqs` y
`clinic_settings` — **las tablas de siempre, sin copia de nada**: lo aplicado
sale en Registros y en la ficha en el acto, y al revés.
- **La tarjeta enseña el antes → el después**, no la frase del modelo: nadie
  aprueba un precio que no ha visto. Se aplica con un clic, como una enseñanza.
- **El cambio se lee de la propuesta guardada, nunca del cuerpo de la acción**:
  del cliente sólo se acepta CUÁL cambio (`messageId` + `ref`). Si no,
  cualquiera con sesión escribiría el precio que quisiera pasando por ahí.
- **"Ya no lo hacemos" es DEACTIVATE, nunca borrar**: un tratamiento está
  referenciado por citas ya dadas y por `professional_treatments`. El borrado
  duro sólo existe para las FAQs, que no cuelgan de nada.
- El id del tratamiento o de la FAQ sale del catálogo que el prompt le da entre
  corchetes; **un id inventado se descarta al parsear**, igual que un cambio que
  no cambia nada o un precio ilegible: es preferible a enseñar una tarjeta que
  al pulsarla va a fallar.
- Los precios se leen con `parseAmountToCents` de `lib/agenda/billing.ts`, el
  mismo lector que los cobros. Dos lectores de importes en la misma app se
  separan al tercer caso raro y el que se queda corto guarda 1,5 € donde se
  dijo 1.500.
- El horario de atención y la agenda NO se tocan desde aquí (el horario es un
  jsonb por día y la agenda tiene su propio motor): el prompt se lo dice y
  señala dónde se cambian.
- Mismo listón de rol que el resto (`operator`): quien puede editar un
  tratamiento desde Registros puede hacerlo desde aquí. Pedir `admin` sólo en
  esta puerta haría que el entrenador se negara a lo que la misma persona hace
  a dos clics.

**Ver lo que lee el asistente**: la pestaña "Lo aprendido" trae un desplegable
con el texto EXACTO que se le añade al prompt, generado por
`formatLessonsForPrompt` en el mismo render. La primera pregunta de todo el
mundo es si esto cambia de verdad al asistente o es un cuaderno aparte; con el
texto delante se acaba la duda y se ve por qué una instrucción vaga no cambia
nada.

**Tres pestañas por URL** (`?tab=ensenar|aprendido|probar`, Server Components,
no `TabsContent`): la charla con el entrenador y sus tarjetas; la lista de lo
aprendido (editar, pausar, borrar, o escribir una a mano); y **Probar**, que
reusa el `WhatsappTester` de `/dashboard/agent` — el asistente de verdad, con
lo recién enseñado. Sin ese último paso el entrenamiento es un acto de fe.

**Idempotencia de la aprobación**: cada propuesta lleva `ref`
(`<messageId>-<índice>`) y al aplicarla se marca dentro del `proposals` jsonb de
su turno. Sin eso, recargar la página devolvía la tarjeta a "pendiente" y la
misma enseñanza se aprobaba dos veces.

**Roles**: `operator` en adelante, el mismo listón que el banco de pruebas y que
cargar tratamientos o FAQs. Quien atiende a los pacientes es quien ve al
asistente equivocarse; hacerle pedir permiso a un admin para corregir una frase
garantiza que nadie lo corrija. El gate está en el servidor en las dos vías: el
endpoint del entrenador (`POST /api/agent/training/chat`, `denyUnlessRole`) y
todas las Server Actions (`requireTaskRole`).

**Pausar no es borrar**: una enseñanza en pausa sigue guardada pero el asistente
no la ve. Vaciar la charla tampoco deshace lo aprendido: son dos cosas
distintas.

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

## Equipo Futura (super-admins) y clínicas archivadas

**Ser super-admin = ser miembro de la organización de Futura en Clerk**
(`isSuperAdminTenant`, `lib/modules.ts`). En `/dashboard/futura`, la tarjeta
**Equipo Futura** da acceso por correo (`addFuturaMemberAction`): si la persona
ya tiene cuenta entra al momento como `org:admin`; si no, le llega una
invitación de Clerk. Para ver el panel tiene que elegir la organización de
Futura en el selector. "Quitar" la saca de la organización; nadie se puede
quitar a sí mismo.

**Archivar** (`lib/tenants/archive.ts`) deja la clínica fuera de servicio sin
borrar nada: `tenants.status = 'archived'`. Corte de servidor en
`getCurrentTenant` (lanza `TenantArchivedError`; el layout pinta
`ArchivedClinicNotice`), así que no hay página, acción ni API de esa clínica
que funcione. Al archivar se cancelan recordatorios `SCHEDULED`, ofertas de
lista de espera y de adelanto pendientes (y sus bloqueos de reserva); y
`isTenantArchived` (caché 1 min) frena al asistente de WhatsApp, los envíos de
recordatorios y ofertas, la confirmación del día, los adelantos y las rutinas
(`listActiveTenantIds` excluye archivadas). Futura no puede "Gestionar" una
archivada: sólo restaurarla. ⚠️ La voz no se corta: el número vive en Retell y
Zadarma, hay que apagarlo allí.

**Eliminar** sólo existe para una archivada y exige escribir el nombre exacto
(se compara en el servidor). Borra la fila de `tenants` —todas las FK son
`ON DELETE CASCADE`, así que se va todo lo suyo— y después la organización de
Clerk (si Clerk falla, se avisa para borrarla a mano). La organización de
Futura no se puede archivar ni eliminar.

## Funcionar sin CRM: la agenda propia es la fuente

GoHighLevel es **opcional**. Una clínica sin CRM conectado tiene que poder dar
de alta pacientes, agendar, recordar, recuperar huecos y ver sus métricas. Hasta
la migración de 2026-09-08 no era así: la agenda de la plataforma era una
**isla**, y todo lo demás colgaba de un único disparador, el webhook de citas de
GoHighLevel.

**El seguro que hay que respetar**: cada vez que se toque una cita de
`agenda_appointments`, los efectos los propaga `syncAppointmentEffects()`
(`lib/agenda/sync.ts`). Es el equivalente, para las citas propias, del webhook
`/api/webhooks/ghl/appointment`: espejo en la caché, recordatorios, tareas
automáticas, avisos en `#agenda`, hueco cancelado, oferta de lista de espera y
atribución de recuperación. Se llama desde `createAppointment`,
`rescheduleAppointment` y `updateAppointment`, **fuera de la transacción** (los
efectos leen por otra conexión y necesitan ver el commit). Nunca lanza.

- **Se dispara por TRANSICIÓN, no por estado.** `updateAppointment` lee el
  estado anterior antes de escribir. Sin eso, guardar una nota en una cita ya
  cancelada repetiría la tarjeta del chat y reabriría la oferta al paciente.
- **Un id de cita puede ser de dos orígenes.** Las columnas `ghl_appointment_id`
  de `appointment_reminders`, `cancelled_slots`, `waitlist_entries` y
  compañía guardan el id venga de donde venga: los de GoHighLevel son
  alfanuméricos de ~20 caracteres y los propios son UUID. `isInternalAppointmentId`
  (`lib/agenda/appointment-ref.ts`) es el ÚNICO sitio donde se decide cuál es
  cuál. El nombre de las columnas se dejó por lo que costaría renombrarlas en
  las seis tablas que las referencian; es deuda consciente.
- **La agenda de cada profesional hace de calendario**: `prof:<professionalId>`.
  `cancelled_slots` y la atribución emparejan hueco liberado con cita nueva por
  (calendario, hora), y sin esto la métrica de recuperación era cero.
- **Estados**: la caché se escribe con `completed` / `no_show` / `cancelled` /
  `confirmed`. Son las únicas palabras que satisfacen a la vez a las métricas
  (`lib/data/analytics/global.ts`) y a los ayudantes del webhook.

**El paciente de la plataforma** vive en `whatsapp_contacts`, que pese al nombre
es la libreta de contactos: única por (tenant, teléfono), con nombre, correo y
el id del CRM cuando lo hay. `lib/patients/registry.ts` es la puerta. No se creó
una tabla `patients` aparte para no tener dos libretas que se separan al día
siguiente. La identidad CLÍNICA es otra cosa: la `patient_key` de la agenda
(`lib/agenda/patients.ts`), con prioridad `ghl:` > `tel:` > `email:` > `anon:`.
`contactRefsFor()` devuelve todas las identidades de un contacto, que es como
las fichas del panel encuentran citas de los dos orígenes.

⚠️ `patients_cache` **no la escribe nadie**. Cuatro sitios la leían y salían
vacíos incluso con CRM: los dos barridos diarios de Tareas (presupuesto sin
cita, paciente inactivo) no creaban una sola tarea. Ahora salen de la agenda
(`lib/agenda/sweeps.ts`) y los nombres de `resolveContactNames()`.

**Las tools de los agentes no necesitan CRM** (`lib/retell/tools.ts`):
`register_patient` da de alta en la plataforma, `get_patient_info` responde con
la ficha local más el resumen de la agenda y `set_lead_email` guarda el correo
en la ficha. Ninguna dice ya "el CRM no está conectado": ese mensaje hacía que
el agente considerara la herramienta fallida y derivara a recepción. El único
mensaje que queda para ese caso es "la clínica no tiene su agenda configurada",
y sólo se llega a él sin agenda **y** sin CRM.

**El teléfono del paciente no depende del LLM.** `ToolContext.patientPhone` lo
lleva desde el canal. En voz sale de `metadata.direction`: en una saliente el
paciente es `to_number`, en una entrante es `from_number` — antes se cogía
siempre `to_number` y una llamada entrante daba de alta al paciente con el
número de la propia clínica.

## El asistente de WhatsApp puede no agendar: modo DERIVE

Por defecto el asistente cierra el círculo (informa y reserva). Hay centros que
no lo quieren así — **Train Movements Center** fue el primero: prefieren que
recoja la consulta y se la pase al profesional que la puede atender, y que sea
esa persona quien contacte al paciente y acuerde el día.

**Se enciende desde Futura**, clínica por clínica: `/dashboard/futura` → botón
**Asistente** de cada ficha. Dos opciones ("Agenda la cita" / "Deriva al
profesional") y, en la segunda, un **móvil de respaldo**. Vive en
`whatsapp_agent_settings.agent_mode` (`BOOKING` | `DERIVE`) y
`derive_fallback_phone` (migración `0028_whatsapp_modo_derivacion.sql`). El
defecto es `BOOKING`: una clínica sin fila de ajustes sigue agendando.

**A quién le llega cada consulta** (`lib/whatsapp/agent/derivation.ts`): el
profesional que realiza ese servicio (`professional_treatments`, la misma
relación que usa la agenda, pero **sin exigir `agenda_enabled`** — un centro en
modo DERIVE no lleva su agenda aquí) → el único profesional activo, si sólo hay
uno → el móvil de respaldo. Un profesional sin WhatsApp cargado se sigue
nombrando en el parte, que sale por el respaldo.

**El WhatsApp del profesional es una columna propia**: `professionals.whatsapp_e164`
(migración `0029_profesional_whatsapp.sql`), con su campo en el alta y en la
edición de Agenda → Profesionales, y validado con `lib/whatsapp/phone.ts`. No se
reusó `professionals.phone` porque es texto libre y lleva de todo; y no se
normaliza con `normalizePatientPhone`, que es permisivo a propósito para lo que
llega del canal. **Un móvil local sin prefijo no se acepta**: "600 11 22 33"
normalizado a la fuerza da `+600112233`, un número de otro país que el proveedor
acepta y al que el mensaje sale —cobrado— sin que nadie se entere de que el
profesional nunca lo recibió. El teléfono de contacto sólo se usa de reserva, y
únicamente si ya está en formato internacional; la migración hace ese backfill.
La lista de profesionales avisa de quién no lo tiene, pero sólo cuando la
clínica está en modo DERIVE: en el modo normal ese número no hace falta.

**Quitarle las tools no alcanza.** El prompt de DERIVE es otro
(`buildDerivePrompt`), sin agendamiento y con el protocolo de recopilación, y la
lista de herramientas se filtra por modo; pero además `executeAgentTool`
**rechaza en el servidor** `check_availability`, `book_appointment`,
`cancel_appointment` y `list_professionals` cuando el modo es DERIVE. Un modelo
puede llamar a una tool que no le ofrecieron, y reservar es justo lo que el
centro pidió que no pasara.

**El WhatsApp al profesional lo manda el worker, no la tool.**
`derive_to_professional` sólo resuelve el destinatario y deja el parte en
`AgentOutput.derivation`; `worker/jobs/whatsapp-process.ts` lo envía en su
propio `step.run`, antes de contestarle al paciente (lo que se le dice es que ya
está avisado). Así una segunda vuelta del loop no manda dos avisos, y el banco
de pruebas de `/dashboard/agent` puede correr el agente entero sin escribirle a
nadie.

**La despedida la escribe la app**, no el modelo: él no sabe a quién se enrutó
la consulta, y "te escribe la doctora Ruiz" inventado es peor que no decir nada.

**El hilo del profesional queda con `ai_enabled = false`** en cada aviso. El
parte sale por el número de la clínica, así que su respuesta entra al inbox como
una conversación más — sin esto, el asistente se pondría a atender a su propio
compañero. Y si el móvil del profesional coincide con el del paciente (un número
mal copiado), el aviso no sale: el parte clínico no puede acabar en el móvil del
propio paciente.

**Derivar NO es handoff**: la conversación del paciente sigue con el asistente
encendido. En un centro donde toda consulta termina derivando, apagarlo dejaría
al asistente atendiendo a cada paciente una sola vez. La red de seguridad es la
tarea automática (`WHATSAPP_HANDOFF`) y la tarjeta en el chat interno
(`postWhatsappDerivation`), que se publican aunque el aviso por WhatsApp falle.

⚠️ Con **Evolution** (que es lo que usa Train Movements Center) el aviso sale sin
restricción. Con **Cloud API de Meta** haría falta una plantilla aprobada para
escribirle a un profesional que no haya escrito en las últimas 24 h.

## Perfil de atención por clínica (Respinens: pediatría respiratoria)

**Una sola clínica** (Respinens, fisioterapia respiratoria pediátrica, 0–4 años)
pidió cosas que a un dentista no le dicen nada: la edad con número en la agenda,
una anamnesis propia, madre y padre en la ficha, reglas de reserva para pacientes
nuevos, prioridad por edad. Todo eso va **sólo para ella** y sin interruptores:

- **`tenant_care_profile`** (migración `0030_perfil_pediatrico.sql`): una fila por
  clínica con `booking_policy` (jsonb), `anamnesis_template` (jsonb) y
  `first_visit_protocol` (texto para los asistentes). **Sin fila = todo como
  siempre.** La fila de Respinens la siembra `0031_respinens_perfil.sql` por el
  slug de su organización en Clerk (con caída a "la única clínica cuyo nombre
  empieza por Respinens"). No hay botón en Futura: la única pregunta que hace el
  código es `getCareProfile(tenantId)` (`lib/care-profile/queries.ts`) y si
  devuelve null no pasa nada. Nunca un `if (tenantId === …)`.
- **El teléfono es del tutor, no del paciente.** La libreta (`whatsapp_contacts`)
  es única por teléfono, y detrás de un móvil hay hermanos —gemelos que se
  agendan en horas seguidas—. Por eso existe **`patients`** (el paciente como
  persona: nombre, fecha de nacimiento, `guardians`, `anamnesis`, marcas) que
  cuelga del contacto (`contact_id`). Su identidad en la agenda es
  **`pat:<uuid>`**, que manda sobre `ghl:` y `tel:` (`patientKeyFor`,
  `lib/agenda/patients.ts`). `agenda_appointments.patient_id` y
  `clinical_notes.patient_id` son nullables: el resto de clínicas sigue con el
  contacto como paciente. Módulo: `lib/patients/persons.ts`.
- **`agenda_appointments.is_first_visit`** se calcula al crear la cita (el
  paciente no tenía ninguna cita que ocupara hueco) y no se recalcula. Es lo que
  leen las reglas "no más de dos primeras seguidas" y "lunes y miércoles desde
  las 19:00 sin nuevos". La clínica no marca tratamientos: es un hecho del
  historial.
- **Lo puro va en `lib/care-profile/policy.ts`** (sin base, con tests en
  `tests/unit/care-profile-edad.test.ts`): `describeAge` ("1 año y 8 meses"),
  `priorityLevel` (0–6 m muy prioritario, 6–24 m prioritario, o marca manual —la
  marca nunca baja lo que da la edad), `isFirstVisitBlackout`,
  `isPatientAgeAllowed`, tutores y anamnesis. Las edades son claves
  `YYYY-MM-DD`, no instantes: un cumpleaños es una fecha, no un momento.
- **Panel**: con perfil, la lista de pacientes gana la columna Edad y el botón
  "Nuevo paciente" (`components/agenda/patient-dialog.tsx`); la ficha
  (`pacientes/[key]`) pinta la anamnesis arriba (`anamnesis-card.tsx`), las
  marcas (`patient-marks.tsx`: prioritario + motivo que leen los asistentes,
  reseña en Google, última carita) y la historia **en orden cronológico** con
  Síntomas / Exploración / Tratamiento / Diagnóstico / Observaciones y la carita
  **por sesión** (`clinical_notes.session_behavior`). El formulario de nota
  recibe `template='PEDIATRIC'`; el resto de clínicas ve el de siempre. En el
  calendario, el chip lleva la edad si el paciente tiene fecha de nacimiento y la
  etiqueta "1ª visita" sólo con perfil; el alta de cita ofrece elegir al paciente
  de la ficha (`patients` → `DialogPatient`) y, si no coincide con ninguno, sigue
  siendo un nombre libre.
- **Borrar una cita nunca borra la nota**: no hay borrado físico (sólo
  `CANCELLED`) y `clinical_notes.appointment_id` es `ON DELETE SET NULL`. La
  ficha con `pat:` existe aunque no haya citas.
- **Reglas de reserva de primeras visitas** (`booking_policy`): franjas vetadas
  (`firstVisitBlackouts`, minutos locales + día ISO) y tope de primeras
  **seguidas** (`maxConsecutiveFirstVisits`; "seguidas" = sin un hueco libre
  entre medio: menos de una duración de separación forma cadena, una cita de
  seguimiento o un rato libre la corta). Viven en el motor puro
  (`describeFirstVisitConflict`, `lib/agenda/availability.ts`, tests en
  `tests/unit/agenda-primeras-visitas.test.ts`) y se aplican en DOS sitios: al
  ofrecer huecos (`getAvailability({ firstVisit })`, que es lo que ven los
  agentes vía `findAgentSlots`) y al crear la cita (`createAppointment`), porque
  un agente puede pasar un `start_time` que no salió de `check_availability`.
  A los agentes se les impone; el panel puede saltárselas a sabiendas con
  `overridePolicy` (la acción devuelve `code: 'POLICY'` y el alta de cita ofrece
  la casilla). `check_availability` acepta `first_visit`; si el agente no lo
  manda, se deduce del teléfono del canal (`phoneHasHistory`).
- **Los asistentes atienden como la clínica** (`lib/care-profile/agent.ts`): con
  perfil, `get_patient_info` devuelve los niños del teléfono (edad, prioridad,
  aviso, `patient_id`), `register_patient` da de alta al NIÑO (`birth_date`
  obligatoria, `guardian_name` = titular del teléfono, `medical_alert` marca
  `needs_human_review` y bloquea la cita) y `book_appointment` exige
  `patient_id` (o resuelve por nombre entre los niños del teléfono) y rechaza
  edad fuera de rango o aviso médico pendiente. La sección de prompt la arma
  `buildCareProtocolSection` (pura, con test) y entra igual en WhatsApp
  (`careProtocol` de `buildSystemPrompt`) y en voz (variable `{{care_protocol}}`
  de `buildClinicContextVars`). Todo lo que el prompt pide, el servidor lo impone
  además por su cuenta.
- **Cumpleaños**: el barrido diario (`task-daily-sweep`) publica en `#agenda` una
  tarjeta `patient.birthday` por paciente y año (`lib/care-profile/birthdays.ts`,
  sólo clínicas con perfil; quien nació un 29 de febrero lo celebra el 28 los
  años no bisiestos, `isBirthdayOn`). Aviso interno con acciones de llamar y
  abrir la ficha; no se escribe a la familia.
- **Lista de espera**: `findNextEligibleEntry` reordena la cola por prioridad
  (`sortByPriority`, estable) cuando las entradas son `pat:<id>` y la clínica
  tiene perfil; a igualdad manda la antigüedad de siempre. Sin perfil, la cola
  no cambia.
- ⚠️ **Voz, pasos manuales por clínica con perfil**: (1) agente + LLM propios en
  Retell (`agent_configs.retell_agent_id/retell_llm_id`; hoy todas comparten
  dos LLM) cuyo prompt referencie `{{care_protocol}}`; (2) correr
  `scripts/retell/sync-agenda-tools.ts`, que ya declara `first_visit`,
  `patient_id`, `birth_date`, `guardian_name` y `medical_alert`; (3) el DID de
  Zadarma de la clínica apuntando a ese agente.

## Sin contactos ni fichas duplicadas, y una nota por visita

Respinens no conectaba su WhatsApp hasta que esto estuviera resuelto: con fichas
duplicadas, la IA podía agendar en la que no tiene la historia clínica.

- **Teléfonos**: `normalizePatientPhone` pone `+34` a un número español de nueve
  dígitos tecleado sin prefijo (antes salía `+600112233`, que no es el
  `+34600112233` de WhatsApp). `samePhone`/`samePhoneSql` comparan con y sin
  prefijo de país.
- **Un número, un contacto**: todo alta en la libreta (`upsertWhatsappContact`,
  `upsertPatientRecord`, `setPatientEmail`) pasa antes por
  `canonicalContactPhone` (`lib/patients/registry.ts`): si el número ya existe
  escrito de otra forma se usa ese contacto, y si lo que llega trae el prefijo
  se corrige lo guardado (y las claves `tel:` de citas, notas, cobros y
  facturas).
- **Evolution `@lid`**: un `<id>@lid` no es un teléfono; se usa
  `remoteJidAlt`/`senderPn`. Los mensajes de grupos (`@g.us`) se ignoran.
- **Otro tutor**: `listPatientsForPhone` encuentra a los niños también por el
  teléfono de cualquier tutor de `guardians`, y la lista de pacientes no
  muestra a ese tutor como paciente nuevo.
- **Fichas**: `createPatient` rechaza (`DuplicatePatientError`) un niño con el
  mismo nombre y misma fecha de nacimiento (o mismo teléfono si falta la
  fecha). El asistente y la importación reutilizan la existente; el asistente
  además casa por nombre entre los hijos del teléfono aunque la fecha dictada
  no cuadre.
- **Unir duplicados ya creados**: en Agenda → Pacientes, las filas con el mismo
  nombre salen como "Posible duplicado" con el botón **Unir** (sólo admin,
  `mergePatientRecords`). Cualquier fila puede ser la que se queda y cualquiera
  se puede dejar fuera ("no es la misma persona"). Si entre ellas hay una
  ficha de paciente, el resultado es SIEMPRE esa ficha (nacimiento, anamnesis,
  tutores, consentimientos); si se eligió otra fila, su nombre y teléfono pasan
  a la ficha. Los teléfonos de lo unido quedan como tutores.
- **Citas sin ficha elegida**: `createAppointment` sin `patientId` pero con el
  teléfono y el nombre de un niño que ya tiene ficha la ata a esa ficha.
- **Bucket interno**: `mediaUpload` crea el bucket si no existe (pasó con
  `internal-files` en producción: PDF firmados, facturas y comprobantes no se
  guardaban).
- **Una nota por visita**: `saveClinicalNote` sin id actualiza la nota de la
  misma cita o del mismo paciente, profesional y día (privada con privada); la
  ficha abre esa nota en el formulario para completarla. La migración `0047`
  juntó las repetidas y corrigió los `+6xxxxxxxx`.
- **Notas con formato** (negrita, cursiva, subrayado, rojo/naranja/verde/azul,
  resaltado, listas) en Síntomas, Exploración, Diagnóstico, Observaciones y
  Próximo paso; **Tratamiento queda en texto plano** (lo pidió así la clínica).
  Se guarda en las mismas columnas con un subconjunto mínimo de etiquetas
  (`lib/rich-text.ts`, con tests): `sanitizeRich` al guardar, `<RichText>` para
  pintar (árbol de elementos, **nunca `dangerouslySetInnerHTML`**) y
  `richToPlain` para quien necesita texto (agentes, barridos). El editor
  (`components/ui/rich-text-editor.tsx`) recoge las herramientas tras un botón
  de pincel (se despliegan al pulsarlo) y pega siempre como texto plano. Sin
  selector de tipografía: la ficha usa la del panel.
- **Tareas con nombre**: `resolvePatient` (`lib/tasks/hooks.ts`) entiende
  `pat:<uuid>`; antes las tareas de citas anuladas de un paciente-persona
  salían "Paciente sin identificar". Con perfil de atención el barrido no crea
  "Perseguir presupuesto" (el "próximo paso" de la nota es clínico); la `0068`
  archivó las abiertas y puso nombre a las otras.
- **Cambiar el estado de una cita desde el panel deja auditoría**
  (`updateAppointmentAction`: estado anterior y nuevo, `via: 'panel'`): el
  9/11 los estados de varias citas volvían a "Agendada" segundos después de
  guardar la nota y no había forma de saber quién lo hacía.
- **Calendario por colores**: cada estado tiene su color (Agendada teal,
  Confirmada verde, En sala índigo, En gabinete violeta, Atendida gris, No se
  presentó coral; `STATUS_COLORS` en `calendar-view.tsx`) y la leyenda los
  muestra. La primera visita va enmarcada en miel con "1ª visita" (sólo con
  perfil de atención).
- ⚠️ **Los archivos privados los sirve la app, nunca una redirección a MinIO**
  (`mediaFileResponse` en `lib/storage/media.ts`). Una URL firmada con el
  endpoint interno (`cliniq-minio-…:9000`) no existe fuera de Docker: el PDF
  del consentimiento, los comprobantes, los documentos de Finanzas y los
  adjuntos del chat abrían "No se puede acceder a este sitio".

## Ajustes de Respinens del 19/10 (agenda de papel → agenda)

La clínica marca su agenda de papel con flechas, (H), (1), [D]… y lo usa a
diario para distinguir a cada paciente de un vistazo. Migración `0048`.

- **Chip del calendario**, en el orden en que lo lee: ↑/— (adelantar) · tipo
  (1ª visita naranja, G/M azul, H rosa; también el borde) · hora · nombre ·
  edad · estado (fondo: Agendada teal, Confirmada verde, No se presentó rojo) ·
  pago (datáfono = tarjeta, € = efectivo, ✓ = Bizum/transferencia).
- **Estados visibles**: `booking_policy.visibleStatuses` del perfil (Respinens:
  Agendada, Confirmada, No se presentó). Se OCULTAN en leyenda, hoja de la cita
  y tarjeta "Hoy"; el enum no cambia. Con COMPLETED oculto, `inactivePatients`
  cuenta como visita toda cita pasada no anulada ni faltada.
- **Hermanos** (`lib/care-profile/siblings.ts`, puro con tests): familia = mismo
  contacto o teléfono de tutor; G/M = hermano con la misma fecha de nacimiento;
  H = un hermano YA VINO antes a la clínica (primera cita no anulada ni
  faltada anterior a ese día; NO es "cita el mismo día", lo aclaró la
  clínica). En una primera visita sale "1ª visita (H)". `patients.sibling_mark`
  lo fuerza a mano (Marcas del paciente). La familia también se reconoce por
  los DOS apellidos (`surnamesKey`), y el **tratamiento manda**
  (`familyTagFromTreatment`): "GEMELOS / MELLIZOS" es G/M y nunca "1ª visita"
  (la `0050` lo marca `FOLLOW_UP`), "…HERMANOS…" es H. Hacía falta porque las
  citas de mellizos se daban a veces con nombre libre, sin ficha: sin
  `patientId` el cálculo por familia no llega.
- **Adelantar**: `agenda_appointments.advance_preference` (ACCEPTS | NO_MOVE)
  + `advance_note`, POR CITA. Se pregunta en Nueva cita, se cambia en la hoja de
  la cita, y Lista de espera muestra "Quieren adelantar su cita". Nada se envía
  solo (Fase 1).
- **Pago desde la cita**: botones Datáfono/Efectivo/Bizum/Transferencia y "No
  pagado" en la hoja (`registerPaymentAction`, `markAppointmentUnpaidAction`);
  el calendario carga los cobros del rango en UNA consulta
  (`paymentsForAppointments`).
- **Mover cita** con "Huecos libres ese día": `getAvailability` acepta
  `excludeAppointmentId` (la cita no se bloquea a sí misma).
- ⚠️ **"Reservable hasta" y la antelación mínima son reglas de los AGENTES,
  no del panel.** `getAvailability({ staff: true })` (lo que pide
  `/api/agenda/availability`) las ignora. Con Respinens en 7 días, recepción
  no podía dar ninguna cita de noviembre a mediados de octubre; la `0049` lo
  subió a 60. Sin huecos, la API dice por qué (`DAY_OFF` + `workingWeekdays`)
  y el diálogo ofrece "Darla igualmente"; fuera de horario el servidor lanza
  `AgendaOutsideHoursError` (código `OUTSIDE_HOURS`) y el panel ofrece
  "Guardar igualmente fuera de horario". El botón de guardar dice qué falta.
- **Datos de la clínica** (`/dashboard/settings`): el horario de atención se
  guarda con el "Guardar cambios" del formulario, NO con el de
  "Personalización del agente" que va debajo (la clínica pulsaba ése y el
  horario no se guardaba). Con cambios pendientes sale una barra fija abajo y
  el navegador avisa al salir. La acción exige rol `operator` en servidor y,
  si falta la fila de `clinic_settings`, la crea en vez de decir "guardado".
- **Nombre de la ficha manda**: `listAppointmentsInRange` pinta el nombre de
  `patients`, y `updatePatient` reescribe `patient_name` de sus citas y notas.
- **Búsqueda sin tildes** en Agenda → Pacientes (`foldedWordsFilter`,
  `patientSearchFilter`; `FOLD_FROM` incluye mayúsculas con tilde porque
  `lower()` con locale C no las baja).
- **+34 por defecto**: `PhoneInput` con el prefijo de `dialPrefixForTimezone`
  (nada fijo en el código); los teléfonos de tutores se normalizan al guardar.
- **Fecha de nacimiento < 7 días**: el diálogo pide confirmarla ("0 días" era
  la fecha de hoy puesta sin querer).
- Calendario de 10:00 a 22:00 por defecto; el titular del teléfono ("Mamá:
  Vanesa") encima del número en el listado de pacientes.

## Huecos que se liberan: a quién se le ofrecen (adelantos)

Cuando se cancela una cita de la agenda propia, el hueco no va directo a la
lista de espera: antes se ofrece, de una familia en una, a quien ya tiene cita
y podría adelantarla. Módulos: `lib/agenda/advance-ranking.ts` (el orden, puro,
con tests en `tests/unit/agenda-adelanto-orden.test.ts`) y
`lib/agenda/advance-offers.ts` (la oferta: reserva, WhatsApp, respuesta,
caducidad). Tabla `advance_offers` (migración `0061`).

**El orden lo fijó la clínica y no se toca a la ligera**:

**En el mismo día no se mueve a nadie** (la clínica, 6/11: "eso ya me
encargo yo en clínica"; la flecha ↑ es "avisadme si se libera algo antes" en
DÍAS). Se quitaron las dos fases del mismo día que hubo (la de ↑ y la del
"resto desde la última hora").
0. Antes que nadie, el paciente que la clínica eligió desde su ficha con
   **"Prioridad"** (`slot_priority_requests`, migración `0063`;
   `lib/agenda/priority-requests.ts` + `PrioritySlotButton`): tenga o no cita.
   Un clic, sin fechas ni motivo (la clínica lo pidió así): queda activa
   hasta que tenga la cita o se desactive (`openEnded`, tope de 60 días);
   el profesional sólo se pregunta si hay más de uno. Si acepta, se le
   CREA la cita (`source = WAITLIST`) y le llegan los mensajes de
   confirmación de la clínica (`clinicBookingMessages`). Es "la niña que
   está muy malita" de Raquel (5/11).
1. Después, los **tres días siguientes**, uno a uno: primero quien
   tiene cita a **la misma hora** que el hueco, luego la de justo antes (una
   duración por encima), luego la de justo después. Con ↑ **o sin marca**
   (la clínica, 5/11: "por norma general la gente siempre quiere
   adelantar"; sólo queda fuera "no mover"); a igual hueco, primero ↑. A esa
   familia sólo le cambia el día, no la hora, y acepta más.
2. Sin nadie, el hueco sigue su camino de siempre: lista de espera.

Quien marcó **"no mover" no entra nunca**. Sólo citas posteriores al hueco,
del mismo profesional y que quepan en él. La casilla **"Ofrecerle el primer
hueco que se libere"** (`advance_priority`, migración `0062`) es la orden "si
se libera algo hoy, a X": esa cita va la primera dentro de su fase (↑ ámbar
en el calendario).

⚠️ **El hueco se comprueba LIBRE antes de cada oferta** (`slotIsFree`: sin
cita viva ni bloqueo ajeno sobre ese rato) y otra vez al aceptar. El 5/11/2026
se ofreció a tres familias un hueco de las 18:00 que seguía ocupado: la
cancelación que disparó la oferta era de una cita solapada con otra que seguía
en pie. Una cancelación ya no equivale a "hueco libre".

**Horario de ofertas: de 08:00 a 23:00** (Raquel, 10/11). Un hueco que se
libera de noche, o una oferta que caduca a deshoras, va a `advance_offer_queue`
(migración `0066`) y lo ofrece el tick a partir de las 08:00
(`flushNightOfferQueue`; sin nadie, lista de espera). Una oferta sólo sale si
sus 20 minutos terminan antes de las 23:00 (`isOfferHour`).
**"Ofrecerle el primer hueco que se libere"** (`advance_priority`) vale para
cualquier día posterior, no sólo los tres siguientes ni la misma hora, y va
antes que la fase de "misma hora" (el 9/11 una cita marcada se quedó sin
oferta por estar a otra hora). **La marca de adelantar sobrevive al cambio de
cita**: `book_appointment` con `replaces_appointment_id` copia
`advance_preference`/nota/prioridad a la nueva, y si la familia pidió aviso
antes de reservar (`conversationWantsEarlier`) la cita nace con
`wants_earlier`. Sin cita, `request_earlier_appointment` ya no deja prometer
"te avisamos": el asistente reserva y la marca va en la reserva.

**Respuestas ambiguas (11/11)**: un «sí»/«no» suelto sólo contesta a la
oferta si después de ella nadie más les escribió (`talkedAfterOffer`; no
cuentan la oferta, su recordatorio ni los mensajes que nombran la hora del
hueco) o si citan la oferta. Ese día la familia preguntó «¿hay algo más
pronto?», el asistente le dio el lunes, contestó «No, gracias» a esa lista y
el sistema cerró la oferta de hoy como rechazada. Y si con la oferta abierta
escriben «hola» o «¿hay algo antes?» (`asksAboutSlots`), se les recuerda la
oferta (`remindOffer`) en vez de pasar al asistente, que no la conoce. El
texto ya no dice «la cita … el mañana» (`withArticle`).
**Mientras el hueco está reservado para la cadena de ofertas, el asistente no
lo ofrece a nadie** («hoy no me queda nada»): es a propósito, para no darlo
dos veces. Si la clínica lo ofrece a mano en paralelo, puede acabar con dos
familias en el mismo hueco (pasó el 11/11: dos citas a las 19:30 en nueve
minutos).

**Cómo va la oferta**: el hueco queda **reservado con un bloqueo** de la
agenda (`professional_time_off`, motivo "Hueco reservado…") mientras la
familia contesta: **20 minutos** (la clínica: 2 h → 45 min el 5/11 → 20 min
el 6/11), o hasta 30 min antes del hueco si es antes. El WhatsApp lo dice con
sus palabras ("Si en un plazo de 20 minutos no tenemos respuesta, se ofrecerá
a otro peque", `validityLine`). **Nunca se le ofrece a la familia que dejó el
hueco** (mismo `patient_id`/`patient_key` que la cita liberada: el 6/11 una
madre cambió del miércoles al viernes y se le ofreció su propio miércoles) y
**una respuesta que cita OTRO mensaje no contesta la oferta**
(`quotedTextFrom`/`quoteIsForOffer`: su "sí, gracias" a la confirmación de la
cita devolvió la cita al miércoles). **Aceptado para HOY** → la cita queda
`CONFIRMED` con `appointment_day_of.outcome` (así no sale el recordatorio del
día un minuto después) y el "¡Hecho!" lleva las indicaciones del guion
`dayOf.confirmed` sin su primer párrafo (`dayOfReminderTailFromScript`), en un
solo mensaje. Se manda
por el WhatsApp de la clínica con dos opciones (1 Sí / 2 No; botones en
Cloud API, numeradas en Evolution). **Sí** → se quita el bloqueo, se mueve la
cita (`rescheduleAppointment`) y el hueco que deja se ofrece al siguiente con
la misma regla. **No** o sin respuesta (`expireAdvanceOffers`, en el tick de
cada 5 min) → siguiente familia; a quien ya rechazó ese hueco no se le vuelve
a ofrecer (una oferta CANCELADA porque el hueco se ocupó entre medias no
cuenta: si vuelve a liberarse se le ofrece otra vez). La respuesta a la familia
sale ANTES de pasar al siguiente. **Respuestas que llegan tarde**: mientras la
oferta siga SENT (el plazo venció pero la revisión de cada 5 min aún no pasó)
su "sí" vale; hasta 30 min después de caducar se le contesta que el plazo
terminó, con su cita, y queda con "quiere adelantar" (antes iba al asistente,
que no sabía nada de la oferta). Si la clínica le dio el hueco a mano o le
movió la cita mientras tanto, no le llega "dejamos vuestra cita como estaba"
(`familyAlreadyHandled`). Hay una prueba de extremo a extremo contra el
entorno de QA en el scratchpad de la sesión (`qa/e2e-adelanto-v2.ts`, 13
comprobaciones: nadie en el mismo día, día siguiente misma hora, texto de los
20 min, "sí" que cita otro mensaje, aceptación, hoy → confirmada con las
indicaciones en un solo mensaje).
Cada paso deja tarjeta en `#agenda`, y el panel cuenta los huecos
ofrecidos en "Requiere atención". **La reserva (`HOLD_REASON`, en
`lib/agenda/shared.ts`) frena a los agentes, no a recepción**:
`createAppointment` desde el panel y la disponibilidad `staff` la ignoran
(el 5/11 no se pudo meter a una familia por ella). En el calendario sale en
ámbar como "Reservado: oferta enviada" y la X para quitar cualquier bloqueo
está siempre visible (antes sólo con el ratón encima, y en tablet no salía).

## Confirmación obligatoria del día (Respinens)

`lib/care-profile/day-of-run.ts` + `day-of.ts` (puro, con tests). Secuencia del
día de la cita: recordatorio 08:00 → aviso 09:00 → el mismo aviso otra vez por
WhatsApp a las 10:00, 11:00 y 12:00 (`dayOf.callVia = 'whatsapp'`, migración
`0067`; sin esa clave los pasos de `callAt` son tareas de llamar) → anulación
12:30 sin respuesta. Estado en `appointment_day_of`.

⚠️ **La confirmación que vale es la del MISMO día** (lo pidió la clínica: "es
sólo el recordatorio; el martes lo volverás a recibir y ése sí hay que
confirmarlo"). Hasta el 10/11 tres cosas de antes del día tapaban el
recordatorio y la cita se quedaba sin confirmar: un "1" al asistente días antes
(`answerDayOf` marcaba la respuesta y la cita Confirmada), un "Enviar
recordatorio ahora" el viernes (dejaba `reminder_sent_at` y el del día no se
reclamaba) y la respuesta del día anterior de una cita movida. Ahora:
- **Estado que no se tocó hoy = de otro día**: el tick lo reinicia
  (`resetDayOfState`) antes de mandar, y una cita Confirmada antes del día
  vuelve a Agendada hasta que conteste.
- **Confirmar antes del día no confirma**: `answerDayOf` contesta "tomamos
  nota, ese mismo día te llegará el recordatorio" y no toca nada; la tool
  `confirm_appointment` lo dice como `early`.
- Confirmada HOY desde el panel (status CONFIRMED tocado hoy) no recibe nada.
- **Pasada la hora de anular no empieza la secuencia** (`nextDayOfStep`): un
  recordatorio a las 16:00 anularía la cita cinco minutos después.
- **Va SÓLO al teléfono que dio la cita** (`dayOfRecipients`; sin teléfono en
  la cita, el titular de la ficha). Del 10 al 11/11 iba a todos los tutores y
  Raquel lo pidió fuera: «que sólo le llegue al que agendó, como antes».

Prueba de extremo a extremo contra QA en el scratchpad de la sesión
(`qa/e2e-dia-cita.ts`, 9 casos, con hora simulada de las 09:00).

## Salud del canal de WhatsApp (incidente del 11-12/11/2026)

Del 11/11 a las 18:15 al 12/11 a las 08:20 la sesión de Evolution de Respinens
recibía los mensajes con 2-4 h de retraso: sólo los entregaba al reconectarse,
cada ~50 min. Causa (logs de Evolution v2.3.7): sesión cifrada (Signal)
corrupta, `Bad MAC` y `jidDecode` en los reintentos, WhatsApp cortando el
stream; a las 08:20 la desvinculó (401). **Los envíos seguían funcionando**, así
que desde la app no se notaba nada. Consecuencias: los "1" del recordatorio no
llegaron, el asistente contestó a las 04:00 lo preguntado a las 19:00 y a las
12:30 se anularon siete citas (tres confirmadas a mano: ver abajo). El ciclo de
reconexiones cada 50 min empezó el 6/11, cinco días antes, sin que nadie lo
viera. Lo que quedó (migración `0071`, `lib/whatsapp/health.ts` +
`health-model.ts` puro con tests):

- **Se mide el retraso de cada entrante** (webhook de Evolution:
  `messageTimestamp` contra la hora de llegada, también los ecos del teléfono de
  la clínica). Más de 10 min → `last_lagged_inbound_at` y el canal cuenta como
  no fiable 3 h; a tiempo → `last_fresh_inbound_at`.
- **Avisos al equipo** (tarjeta `wa.channel_problem` en #urgencias, una cada
  3 h): recibe con retraso, desconectado (siempre) y **inestable** (12 o más
  reconexiones en 24 h: la señal previa a la caída).
- ⚠️ **Nunca se anula una cita por falta de respuesta sin prueba de que el
  canal recibe** (`cancelDoubt` en `day-of-run.ts`): la cita sigue "Agendada",
  el recordatorio salió con al menos 90 min de margen y entró algún mensaje a
  tiempo desde entonces sin ninguno con retraso. Si no, `outcome = NEEDS_CALL`:
  no se anula, tarea de llamar y tarjeta "Sin confirmar, NO anulada". Su "1"
  tardío sigue valiendo.
- **Confirmada hoy = confirmada**, haya salido o no el recordatorio. La
  excepción del panel sólo miraba citas sin recordatorio (fallo del 10/11): una
  confirmación a mano a las 08:31 se anulaba a las 12:30. Un "1" escrito ANTES
  del recordatorio de hoy (que llega tarde) no confirma.
- **Sin canal fiable no se ofrecen huecos** (`offerFreedSlot`): ni adelantos ni
  lista de espera; tarjeta "Hueco libre sin ofrecer" para hacerlo por teléfono.
- **Mensajes que llegan tarde**: el asistente recibe cuándo se escribieron
  (`lateNotice`, al final del prompt) para leer bien "hoy a las 19:00"; de
  noche (23-08) y con más de 30 min de retraso se contestan a las 08:00
  (`DeferJobError`); con más de 12 h (resincronización al volver a vincular) no
  se contestan solos: pasan al equipo.
- ⚠️ **El lote de una conversación empieza después del último mensaje ya
  contestado** (el disparador del último run), no después de la hora del run.
  Con la hora del run, lo que entraba mientras el asistente pensaba (~4 al día)
  no lo contestaba nadie.
- **Esperar a otro job no gasta intentos**: `ConversationBusyError` → el worker
  aplaza el mismo job (`moveToDelayed` + `DelayedError`, tope 40). Antes se
  agotaban los 3 intentos en 6 s y saltaba en falso el aviso de "no pudo
  contestar" (que además ya no avisa si otro lote cubrió el mensaje).
- Operativa pendiente tras el incidente: actualizar Evolution (bug de Baileys
  con contactos LID), recrear la instancia limpia y volver a vincular
  (borrando antes los dispositivos vinculados del teléfono), rotar el apikey de
  la instancia y el token del webhook (salen en claro en los logs VERBOSE),
  bajar el log a ERROR,WARN y dar acceso SSH para leer logs antiguos (Dokploy
  sólo guarda las últimas 10.000 líneas).

## Señales de conducta del paciente (Respinens): duda y banderas rojas

La clínica las llevaba con emojis en el nombre de cada contacto de Google (🤔
familias que dudan, una 🚩 por cada falta o cancelación). Migración
`0043_paciente_senales.sql`; se pintan **sólo con perfil de atención**.

- **La duda es una marca a mano** (`patients.hesitant` + `hesitant_note`), en
  la tarjeta "Marcas del paciente" de la ficha.
- **Las banderas rojas se CUENTAN, no se guardan**: citas `NO_SHOW` y
  `CANCELLED` de la agenda (`countRedFlagsByPatientKey`, una consulta
  agrupada; regla pura en `lib/care-profile/signals.ts`, con tests).
  `patients.prior_red_flags` es un **ajuste a mano con signo** (migración
  `0070`): positivo = las de antes de la plataforma, negativo = quitadas. En la
  ficha el campo es el TOTAL (`priorForTotal`): poner 0 las quita todas,
  también las contadas, y una falta nueva vuelve a sumar desde ahí. El total
  nunca baja de 0 (`totalRedFlags`).
- **Cambiar la cita de día no es bandera**: la vieja se anula con
  `RESCHEDULE_REASON` ("Cambiada por el paciente", `lib/agenda/shared.ts`) y
  se excluye del conteo (`isRescheduleReason`, también en el SQL de
  `countRedFlagsByPatientKey`). El 6/11 una madre que cambió de día amaneció
  con 🚩.
- **Una cancelación de la clínica no es bandera**: `agenda_appointments.cancelled_by`
  (`PATIENT` | `CLINIC`; NULL = sin dato, cuenta como familia). Con perfil, el
  botón "Cancelar cita" pregunta quién cancela. Agentes y recordatorios anulan
  como `PATIENT`; la lista de espera, al adelantar una cita, como `CLINIC`.
- Se ven en la cabecera de la ficha, en la lista de pacientes, en el chip del
  calendario y en la hoja de la cita (`components/agenda/patient-signals.tsx`).
  Los asistentes todavía no las leen.

## Consentimiento informado con firma digital (Documenso, por WhatsApp)

Respinens firma el consentimiento informado de cada menor **con un clic desde la
ficha del paciente**: la app genera el PDF con los datos del niño y del tutor ya
rellenos, lo crea en la instancia de Documenso **propia de la clínica**
(`consentimiento.respinens.es`, proyecto "Respinens" en Dokploy, compose
`respinens-documenso`) y manda el enlace de firma por el WhatsApp de la clínica.
El tutor lo firma desde el móvil; Documenso avisa por webhook y el PDF sellado
queda en el bucket interno. Migraciones `0032_consentimientos.sql` (tablas) y
`0033_respinens_consentimiento.sql` (la plantilla de Respinens, por slug).

- **Sin interruptor**: la ficha enseña la tarjeta (`components/agenda/consent-card.tsx`)
  cuando la clínica tiene fila en `esign_integrations` (URL, token de API y
  secreto del webhook, cifrados con `ENCRYPTION_KEY`) **y** una
  `consent_templates` activa (`tenantHasEsign`). Futura las da de alta desde
  `/dashboard/futura` → **Firma digital** (`esign-dialog.tsx`), que prueba el
  token antes de guardar. Sólo pacientes-persona (`pat:`): el consentimiento es
  del niño.
- **El PDF lo tipografía la app** (`lib/consents/pdf.ts`, pdf-lib, puro, con
  tests), no una plantilla de Documenso: así sale relleno y sabemos dónde van la
  firma y la fecha (porcentajes de página, origen arriba a la izquierda, que es
  como los quiere Documenso). Las declaraciones ("Al firmar declaro que…") se
  imprimen antes de la firma; no se usan casillas de Documenso. Helvetica sólo
  sabe WinAnsi: `sanitize` quita lo que no cabe (emojis, flechas) en vez de
  reventar.
- **El texto es de la clínica**: bloques `heading | paragraph | bullets | numbered`
  en `consent_templates.body` (`lib/consents/template.ts`), más
  `acknowledgments` y `message_template` del WhatsApp (`{{tutor}}`,
  `{{paciente}}`, `{{clinica}}`, `{{enlace}}`; si falta `{{enlace}}` se añade).
- **API v2 de Documenso** (`lib/consents/documenso.ts`): `POST /api/v2/document/create`
  en multipart con el PDF, el tutor como firmante y sus campos (SIGNATURE +
  DATE) en la misma petición, `externalId` = nuestro id → `GET /api/v2/document/{id}`
  para el `token` del firmante (enlace = `<instancia>/sign/<token>`) →
  `distribute` con `distributionMethod: 'NONE'`. ⚠️ **La v1 no sirve** con el
  almacenamiento en base de datos de estas instancias: su alta va por URL
  prefirmada y responde "Create document is not available without S3
  transport". Documenso exige correo por firmante: sin correo del tutor se usa
  `tutor.<dígitos>@sin-correo.invalid` (los correos están apagados). El PDF
  firmado se baja por `/api/v2/document/{id}/download?version=signed`, con
  caída a la v1.
- ⚠️ **El enlace de firma se COMPRUEBA antes de mandarlo**
  (`resolveCreatedDocument`, `lib/consents/documenso.ts`, con tests). En
  octubre de 2026 tres familias recibieron el consentimiento de OTRO niño: el
  WhatsApp iba al tutor correcto, pero el enlace se resolvía leyendo el
  documento por el `id` numérico del alta y cogiendo el primer firmante sin
  mirar nada. Ahora sólo vale un documento con NUESTRO `externalId` y cuyo
  firmante tenga el correo con el que se creó (primero por `envelopeId`, luego
  por id); si no cuadra, no se envía nada. "Comprobar firma" rechaza un
  documento con otro `externalId` y el PDF firmado se baja con el id que manda
  el webhook. La tarjeta lleva `key={patientId}` para no arrastrar datos del
  tutor entre fichas.
- **El WhatsApp sale firmado como equipo** (`senderType: 'HUMAN'` en
  `sendAgentResponse`): en el inbox no parece escrito por el asistente. Si no
  hay conector o el envío falla, el documento ya existe y la fila guarda el
  enlace: la tarjeta ofrece "Copiar enlace" para mandarlo a mano.
- **Webhook** `POST /api/webhooks/documenso/<tenantId>`: la clínica va en la URL
  (cada una tiene su instancia y su secreto); `X-Documenso-Secret` en claro,
  comparado en tiempo constante contra `esign_integrations`. En
  `DOCUMENT_COMPLETED` (`completeConsent`) se baja el PDF, se guarda en
  `tenants/<tenant>/consents/<id>.pdf` del bucket interno, la fila pasa a
  `SIGNED` y se publica `consent.signed` en `#agenda`. Devuelve 500 si falla la
  descarga para que Documenso reintente. Idempotente.
- **PDF firmado**: `GET /api/consents/<id>/pdf` firma la URL en cada lectura
  (10 min) y redirige; la fila se busca por (clínica de la sesión, id).
- ⚠️ **Alta de la instancia (manual, una vez por clínica)**: DNS del dominio → IP
  del VPS (Traefik emite el certificado solo); entrar a Documenso, crear la
  cuenta de la clínica (`NEXT_PUBLIC_DISABLE_SIGNUP=false` sólo mientras tanto,
  luego `true` y redeploy), Ajustes → API Tokens (uno sin caducidad) y Ajustes →
  Webhooks (evento `DOCUMENT_COMPLETED`, URL y secreto que muestra el diálogo de
  Futura); pegar URL + token + secreto en Futura → Firma digital. El correo de
  Documenso sale por Resend (`NEXT_PRIVATE_SMTP_TRANSPORT=resend`); sólo se usa
  para la cuenta, no para firmar.

## Ficha del paciente: cabecera, pestañas y Contable (diseño "Perfil Paciente v3")

La ficha (`/dashboard/agenda/pacientes/[key]`) sigue el diseño de Claude Design
"Perfil paciente Respisens" (`Perfil Paciente v3.dc.html`, variante 1b
"cabecera + pestañas"), pedido para Respinens y aplicado a **todas** las
clínicas: lo pediátrico (edad, tutores, anamnesis, caritas) sólo sale cuando
la clave es `pat:` y la clínica tiene perfil; el resto ve la misma cabecera y
las mismas pestañas con sus datos de contacto.

- **Cabecera** (`components/agenda/patient-header.tsx`): tarjeta con nombre,
  prioridad y reseña como badges, "Editar" (el `PatientDialog` de siempre) y una
  tira de datos: Edad · Nacimiento · Tutores · Última sesión · **A tener en
  cuenta**. Esa última línea la arma `describeWatchouts()`
  (`lib/care-profile/policy.ts`): los "sí" de los ítems de la anamnesis con
  `alert: true` en la plantilla, más el motivo de la prioridad manual. Qué
  ítems avisan lo decide la plantilla de la clínica (`0034` marca los de
  Respinens: enfermedad importante, prematuro, ingresos, alergias, PA, RGE,
  antecedentes), nunca el código.
- **Pestañas por URL** (`?tab=visita|anamnesis|historia|citas|contable`,
  `components/agenda/patient-tabs.tsx`): contenido de servidor, sólo se pinta
  la activa (regla de rendimiento del panel). Anamnesis sólo con plantilla.
  Contadores: `9/14` en Anamnesis (en móvil, lo pendiente), nº de notas, nº de
  citas y **cobros pendientes** en Contable; en ámbar cuando piden acción. En
  móvil las pestañas quedan pegadas bajo el topbar (`top-[68px]`) con icono.
  Para quien no puede escribir notas, la pestaña por defecto es Historia.
- **Visita de hoy**: el `ClinicalNoteForm` con cabecera ("Hoy 17:30 · Dra.
  Ruiz · Fisioterapia"), **"Partir de la anterior"** (copia la última nota al
  formulario) y botón de guardar pegado abajo en móvil. A la derecha, sólo en
  escritorio, el resumen fijo: chips de la anamnesis con enlace a completar,
  última visita con su próximo paso, Marcas y Consentimiento. En móvil, en su
  lugar, un aviso "Anamnesis: N sin contestar → Completar" y la última visita
  en línea. El aviso médico pendiente (`needs_human_review`) va bajo la
  cabecera (`patient-review-alert.tsx`), con "Ya valorado".
- **Historia**: línea de tiempo, **la más reciente arriba** (así lo trae el
  diseño v3; antes la pediátrica iba en orden cronológico).
- **Anamnesis**: lo pendiente primero y en ámbar, barra de progreso. El orden
  se fija con lo guardado, no con el borrador: una fila que salta al
  contestarla es lo peor que le puede pasar a quien está tecleando.

**Revisión del 2026-09-23 (52 correcciones)**, lo que cambió de forma y por qué:

- **Cabecera**: migas clicables (Agenda › Pacientes › nombre) en vez del
  eyebrow; avatar con **iniciales** y el bebé como marca pequeña de
  "pediátrico"; acciones rápidas **Llamar · WhatsApp · Agendar · Editar**;
  tira con jerarquía (la edad grande, el nacimiento debajo), tutores con su
  relación y el **titular del teléfono**, contacto formateado
  (`formatPhoneDisplay`, `lib/patients/names.ts`) y "Próxima cita / Agendar"
  cuando no hay última sesión. Los nombres se guardan en **Title Case**
  (`titleCaseName`, en `createPatient`/`updatePatient`, también los tutores).
- **"A tener en cuenta" es un banner** (`patient-alerts-banner.tsx`) con chips,
  no una columna que se cortaba. Las alertas se editan también desde el
  diálogo del paciente ("Alertas clínicas" = ítems con `alert`, vía
  `anamnesisPatch` de `updatePatient`).
- **Prioridad con fuente**: `describePriority()` dice si es por edad, a mano o
  las dos; la cabecera pinta "Prioritario · por edad" y la tarjeta
  "Prioridad y reseña" lo explica, así la casilla manual sin marcar deja de
  parecer un error. La reseña es un interruptor con estado, no una estrella.
- **Pestañas subrayadas y pegadas** (`patient-tabs.tsx`, cliente): se
  distinguen de las píldoras del módulo; cambio optimista con línea de carga
  (`useTransition` + `router.push`); al perder de vista la cabecera muestran
  nombre + alertas. Pestaña nueva **Actividad** (`lib/patients/activity.ts`):
  lee `audit_logs` por `after->>'patientKey'`; **toda acción sobre un paciente
  deja `patientKey` en `after`** (datos, anamnesis, marcas, nota, consentimiento,
  cobro, comprobante). Sin eso no aparece en la ficha.
- **Visita de hoy**: arriba la tarjeta "Hoy" (`today-appointment-card.tsx`)
  con la cita, su estado y los botones Llegó · En gabinete · Atendida, más lo
  pendiente (anamnesis, consentimiento, cobros). La nota siempre se puede
  escribir si el rol lo permite: cuando quien teclea no es profesional
  (recepción, Futura) el formulario pregunta **quién firma**.
- **Anamnesis**: bloques (`group`), nombre completo de siglas (`fullName`),
  texto guía (`hint`), tres estados visibles (sí / no / **Sin contestar**),
  aviso de contradicción (`anamnesisConflicts`: un `exclusive` en sí con una
  alerta en sí), sin barra de progreso, guardar pegado abajo, y **quién la
  guardó y cuándo** (`patients.anamnesis_updated_at/_by`, migración `0035`).
  La plantilla de Respinens se enriqueció por clave en `0035`; **"PA" quedó
  sin nombre completo** porque no sabemos qué significa para la clínica.
- **Tutores** (`guardianSchema`): relación libre (Mamá, Papá, Abuela, Abuelo,
  Tutor/a legal, Otro), teléfono, email y canal preferido por tutor, y
  `primary` = titular del teléfono de la ficha. El contacto (`contact_id`) se
  deriva del titular (`contactFromInput`), y el consentimiento va a él. Hasta
  4 tutores.
- **Consentimiento** (`consent-card.tsx`): estado real (creado / enviado por
  WhatsApp / firmado, según `whatsapp_message_id`), aviso con **Conectar
  WhatsApp** cuando no hay conector, y con uno pendiente el primario es
  "Comprobar firma", no "Enviar" otro. Las acciones van bajo la cabecera de la
  tarjeta, no encima del título.
- **Agendar desde la ficha**: `/dashboard/agenda?paciente=<key>` abre el alta
  de cita con el paciente puesto (`newAppointmentFor` en `CalendarView`).
- **Global**: un solo indicador de impersonación (chip ámbar persistente en el
  topbar, `impersonation-chip.tsx`; el banner se borró), el saludo con nombre
  pasó del topbar al Home, `<main>` lleva `pb-28` para que el dock de chat no
  tape nada, y el sidebar plegado suma `title` a cada ítem.

**Contable** (migración `0034_cobros_paciente.sql`, tablas `patient_charges` y
`patient_charge_files`): Facturado / Cobrado / Pendiente, y por cada cita el
pago (importe, método, fecha) y sus comprobantes.

- **Las líneas son las citas, no los cargos** (`buildBillingLines`,
  `lib/agenda/billing.ts`, puro y con tests en `tests/unit/agenda-cobros.test.ts`):
  una cita sin cargo sale PENDIENTE con el precio del tratamiento
  (`treatments.price_cents`) como importe; una cancelada sin cargo no sale; un
  cargo suelto o cuya cita se borró se lista igual. Un cargo por cita (único
  parcial): registrar el pago dos veces corrige el mismo.
- `amount_cents` **NULL = "sin importe"**, que no es 0 €: pasa cuando se
  adjunta la factura antes de cobrar (`ensureChargeForAppointment` crea el
  cargo PENDIENTE). No cuenta en Facturado pero sí como pendiente.
- **El pago va por Server Action** (`registerPaymentAction`) y **el comprobante
  por endpoint** (`POST /api/agenda/charges/files`, multipart): un archivo no
  cabe en una acción y hay que rechazarlo por tipo y tamaño antes del bucket.
  Si el pago entra y el archivo no, el panel lo dice tal cual. Allowlist: JPG,
  PNG, WEBP, HEIC y PDF, hasta 15 MB. Sin kind explícito, un PDF es Factura y
  una foto Justificante (`inferChargeFileKind`).
- Los comprobantes van al **bucket interno** (`S3_BUCKET_INTERNAL`, key
  `tenants/<tenant>/charges/<cargo>/<uuid>.<ext>`): una factura lleva nombre y
  DNI del tutor. `GET /api/agenda/charges/files/[id]` firma la URL en cada
  lectura (10 min) y redirige; la fila se busca por (clínica, id) y, para un
  profesional que sólo ve su agenda, por su cita.
- **Corregir un pago** (11/11, Raquel cobró 45 en una sesión de 40): en
  Contable, **Editar pago** abre el mismo formulario con importe, forma y fecha;
  en la hoja de la cita, cambiar el importe de una cita pagada muestra
  **Guardar importe** (misma forma y fecha). Es volver a registrar el pago
  sobre el mismo cargo. Lo único que se rechaza en el servidor es cambiar el
  importe de un cobro que ya está en una factura emitida (`registerPayment`).
- **Quién**: quien puede dar citas puede cobrarlas (`requireAgendaWriter`); un
  profesional restringido sólo sus citas (`assertChargeAppointmentInScope`,
  `assertChargeInScope`; un cargo suelto no es de nadie y se le niega). Los
  importes se leen con `parseAmountToCents` ("45", "45,50", "1.250,00").

## Módulo Finanzas (contratable: `enabled_modules.finance`)

Sección `/dashboard/finanzas` (label "Finanzas", icono cartera). Lo pidió
**Respinens**: ver el negocio entero —lo que entra contra lo que sale, con los
tickets y las facturas guardados— y los indicadores que dicen si la clínica va
bien. Es un módulo contratable como WhatsApp o las llamadas: la migración
`0036_finanzas.sql` se lo enciende a Respinens (por slug, como el perfil de
atención) y Futura lo enciende o apaga a cualquiera desde Configuración →
Módulos. Sin él, el sidebar lo muestra con candado y `ModuleGate` lo tapa.

**Los cobros de las citas NO se duplican.** La ficha del paciente sigue siendo
la dueña de `patient_charges`; el módulo los LEE y los une con su libro propio
en un libro unificado (`LedgerLine`, `lib/finance/model.ts`). Tres fuentes:

| `source` | Qué es | De dónde |
|---|---|---|
| `entry` | Gasto o ingreso que no viene de una cita (alquiler, luz, un bono) | `finance_entries` |
| `charge` | El cobro de una cita, tal como lo dejó la ficha | `patient_charges` + su cita |
| `appointment` | Sesión ya pasada y no anulada **sin ningún cargo**: la fuga de cobro | `agenda_appointments` sin fila en `patient_charges` |

**Tablas** (`0036`): `finance_categories` (con la marca **`is_fixed`**: se paga
haya o no pacientes; es lo que sostiene el punto de equilibrio),
`finance_entries` (dos fechas: `occurred_on` = devengo, `paid_on` = caja),
`finance_entry_files` (comprobantes en el bucket interno, URL firmada en cada
lectura por `GET /api/finanzas/files/[id]`) y `finance_settings` (objetivo de
ingresos mensual). Se siembran 14 categorías de gasto y 3 de ingreso la primera
vez (`ensureFinanceProvisioned`, idempotente por único parcial); se renombran o
archivan, no se borran.

**Cobrado o facturado** (`basis`, en la URL: `cash` | `accrual`): en el panel
se llaman así porque "caja" y "devengo" son jerga (revisión del 2026-09-23).
Cobrado cuenta lo pagado por fecha de pago; facturado cuenta por la fecha del
gasto o de la sesión, pagado o no. Lo
pendiente de cobrar y de pagar es un **saldo a fecha**, no un flujo: una sesión
de hace tres meses sin cobrar sigue pendiente aunque el período sea "este mes"
(`openBalances`). Los períodos en curso (este mes, trimestre, año) van hasta
HOY y se comparan con el mismo tramo transcurrido del anterior
(`resolvePeriod`): comparar 23 días de septiembre con agosto entero diría que
el mes va fatal.

**Pestañas por URL** (`?tab=`): **Resumen** (sólo admin: KPI con variación,
semáforo de salud, punto de equilibrio, objetivo, ingresos vs gastos, resultado
acumulado, gastos por categoría, ingresos por tratamiento/profesional/método,
fijos vs variables, pendiente de cobro por antigüedad), **Movimientos** (el
libro con filtros de período, base, tipo, estado, categoría, profesional,
método, origen y texto; alta/edición/pago/comprobante/borrado por línea; "traer
gastos recurrentes del mes"), **Documentos** (todos los comprobantes, del libro
y de los cobros de citas; subir uno abre el alta con el archivo puesto: no
existe un comprobante sin su gasto) y **Ajustes** (sólo admin: categorías,
casilla de fijo, objetivo mensual). `GET /api/finanzas/export` devuelve el
libro filtrado en CSV a la española (`;`, coma decimal, BOM) para la gestoría.

**El semáforo** (`healthReport`, umbrales en `HEALTH_THRESHOLDS`): margen neto,
ingresos vs anterior, pendiente de cobro sobre ingresos, cobertura de fijos,
dependencia de un profesional, sesiones sin cobro registrado y punto de
equilibrio (fijos mensuales / (ticket medio − variable por sesión)). Cada señal
lleva icono, valor y explicación; nunca sólo color. Todo lo puro tiene tests en
`tests/unit/finanzas-modelo.test.ts`.

**Roles** (`lib/finance/auth.ts`): `admin` (la dueña, y Futura) lo ve todo y es
quien borra; `operator` (recepción) carga gastos y comprobantes y ve el libro;
`viewer` y un profesional con acceso restringido no entran. Los cobros de las
citas se tocan desde la ficha del paciente, nunca desde aquí.

**Recurrentes** (`recurrence`: MONTHLY | QUARTERLY | YEARLY, migración `0037`;
`is_recurring` queda como bandera): desde Movimientos se "traen" al mes actual
los que tocan (los mensuales del mes anterior, los trimestrales de hace tres,
los anuales de hace doce): se copian PENDIENTES con
`dedupe_key = rec:<raíz>:<YYYY-MM>`, así que volver a pulsar no duplica
(`replicateRecurring`). El aviso sólo sale si hay candidatos
(`countRecurringCandidates`). No hay cron: es un clic a principio de mes.

**Revisión de UX del 2026-09-23** (50 puntos de una recorrida en producción),
lo que quedó decidido: el Resultado va arriba y grande, Ingresos (verde) y
Gastos (ámbar) debajo y el resto como KPI compactos que llevan a Movimientos
con el filtro puesto; el estado vacío va arriba con el alta dentro y las
tarjetas atenuadas; la variación se lee "vs. agosto 2026" (`previousLabel`
de `resolvePeriod`); los filtros a la vista son período, tipo, estado y
búsqueda, el resto bajo «Más filtros» y como chips; el modal tiene el pie
fijo, validación por campo, IVA por tipo (21/10/4/exento, `taxFromGross`),
método recordado en `localStorage` por tipo, una sola fecha salvo "se pagó
otro día", proveedores sugeridos con su categoría habitual
(`listCounterparties`) y "Guardar y cargar otro"; los comprobantes se
enseñan como dos tipos (factura / ticket o justificante,
`documentKindGroup`) aunque la base guarde tres; en Ajustes todo se guarda
al momento con "Guardado", las categorías se ordenan con flechas
(`reorderCategories`), muestran cuántos movimientos tienen y las archivadas
tienen su sección. Los plurales van por `plural()`: "1 sesión", "3 sesiones".
Pendientes de esa revisión, sin hacer: acciones masivas en el libro, OCR de
facturas, miniaturas y ZIP por período en Documentos, arrastrar categorías.

**El buscador global** (`lib/data/search.ts`) incluye los movimientos del
libro (concepto, proveedor, notas) cuando la clínica tiene el módulo; un
resultado lleva a Movimientos con la búsqueda puesta.

**Gráficos**: `components/finanzas/finance-charts.tsx` (recharts, por
`charts-lazy.tsx`). Un solo eje por gráfico; el color sigue a la entidad (una
categoría conserva su color aunque cambie el filtro: se pasa `colorIndex` desde
el catálogo, no desde el ranking); ingresos en verde de marca, gastos en gris
neutro, resultado como línea oscura.

## Facturas desde la ficha del paciente

Pestaña **Contable** de la ficha → **Nueva factura** (migración `0042_facturas.sql`).
El diseño es la plantilla de Respinens (`Factura Respinens.html`, Claude Design):
logo centrado, banda Documento · Nº · Fecha · Total, Emisor / Facturar a ·
Tutor/a legal / Paciente, tabla de conceptos, base + IVA + total, forma de
pago, observaciones y pie verde. Se dibuja con pdf-lib (`lib/invoices/pdf.ts`,
puro, con tests), igual que el consentimiento.

- **Autocompletado**: tutor titular (nombre, teléfono, correo) de la ficha;
  NIF y dirección del propio tutor (`guardians[].taxId/address`, se recuerdan
  al emitir) o, si no, del último consentimiento; sesiones atendidas sin
  facturar ya marcadas y agrupadas por concepto + precio
  (`groupSessionsIntoItems`); precio del cobro o del tratamiento; forma de
  pago del cobro; concepto por defecto de la clínica.
- **Emisor** en `invoice_settings` (una fila por clínica; la 0042 siembra la de
  Respinens con los datos de su plantilla). Se edita en Finanzas → Ajustes →
  Datos de facturación. Sin fila, se factura a nombre de la clínica.
- **Numeración** `AAAA-0000001` por año, asignada dentro de una transacción con
  `SELECT … FOR UPDATE` sobre `invoice_settings` (dos altas a la vez no sacan
  el mismo número). El próximo número se puede ajustar para continuar una
  serie existente.
- **Inmutable**: la factura copia emisor y destinatario al emitirse. No se
  borra: se **anula** (sólo admin), el número queda, las sesiones vuelven a ser
  facturables y el PDF se regenera con la marca ANULADA.
- `patient_charges.invoice_id` une cobro y factura: una sesión en una factura
  viva no se vuelve a ofrecer. Al emitir se puede registrar el cobro de las
  sesiones pendientes con la misma forma y fecha.
- **El PDF se genera al pedirlo**, no se sirve desde el bucket:
  `GET /api/facturas/[id]/pdf` lo renderiza y lo entrega (`?download=1` como
  adjunto, sin él se abre). La primera versión guardaba el PDF en MinIO y
  redirigía a una URL firmada; en producción ese paso fallaba y la ruta
  respondía 404 con la factura ya emitida. Como la factura es inmutable,
  generarla otra vez da el mismo documento; la copia en el bucket queda como
  archivo best-effort (`archivePdf`). El logo se cachea una hora por proceso.
- **Enviar**: descargar, correo (`mailto:` ya escrito; el PDF se adjunta a
  mano) o WhatsApp (`connector.sendMedia('document')`). El proveedor baja el
  PDF de un enlace **público y firmado de la propia app**
  (`/api/public/facturas/[id]?exp=&sig=`, HMAC de clínica + factura +
  caducidad derivado de `ENCRYPTION_KEY`, 72 h; `lib/invoices/public-link.ts`),
  no del bucket. Queda en el inbox como PDF enviado por el equipo.
- ⚠️ **El modal sólo se reinicia al abrirse** (`wasOpen` ref), no cuando
  cambian sus props: tras emitir, la ficha se refresca y llegan `defaults` y
  `candidates` nuevos, y con un efecto que dependía de ellos la pantalla de
  "factura emitida" se borraba sola. Hay test de regresión.

## Novedades del panel (pop-up de funciones nuevas)

Para contarle a la clínica una función nueva o un cambio de costumbre sin
depender de una llamada. Migración `0069_novedades_y_atendida.sql`.

- **El catálogo vive en el código** (`lib/announcements/catalog.ts`, puro, con
  tests en `tests/unit/novedades.test.ts`): id, fechas de publicación y
  caducidad, público (`all` | `care_profile`), rutas donde sale, textos y una
  ilustración opcional (`visual`, dibujada en
  `components/dashboard/announcement-center.tsx`). **Un id nunca se reutiliza**:
  es la memoria de quién ya lo vio.
- **Lo que hizo cada persona** va en `announcement_views` (tenant, usuario,
  aviso): «Entendido» = `DISMISSED`, no vuelve; «Recordar más tarde» o cerrarlo
  = `SNOOZED` durante `SNOOZE_HOURS` (3 h).
- `AnnouncementCenter` (montado en el layout, nunca para Futura ni
  impersonando) pide `GET /api/announcements` 2,5 s después de cargar, fuera
  del camino crítico, y enseña uno cada vez, sólo en su ruta, nunca encima de
  otro diálogo. La API devuelve lista vacía si algo falla: un aviso no puede
  estorbar el trabajo.
- Primer aviso (10/11/2026, Respinens): **«Marca cada sesión como Atendida»**.
  La `0069` añade `COMPLETED` a los `visibleStatuses` de las clínicas con
  estados propios: sin ese botón, Raquel pulsaba «Agendada» al terminar cada
  sesión (lo destapó la auditoría de `updateAppointmentAction`) y la cita
  confirmada volvía a Agendada. `inactivePatients` sigue contando como visita
  toda cita pasada no anulada ni faltada en esas clínicas: su historia
  anterior no lleva COMPLETED.

## Uso de la plataforma (sólo Futura)

`/dashboard/futura/uso` (botón **Uso de la plataforma** en Panel Futura, gate
`isSuperAdmin`). Para saber cuánto usa cada clínica el panel, qué usa y qué no,
y a quién hay que llamar antes de que se enfríe. Migración `0064_uso_plataforma.sql`.

- **Tiempo activo, no tiempo con la pestaña abierta.** `UsageBeacon` (montado
  en el layout del panel, nunca para super-admins) late cada 60 s a
  `POST /api/usage/beat` sólo con la pestaña visible y actividad (ratón,
  teclado, scroll, toque) en los últimos 3 min. Cada latido suma 1 minuto en
  `usage_minutes` (tenant, usuario, día local de la clínica, sección).
  Dedupe en servidor: si el usuario ya sumó hace < 50 s en ese día, no suma
  (dos pestañas no cuentan doble). Sin Redis a propósito: `getRedis` reintenta
  sin fin y colgaría la petición. El endpoint siempre devuelve 204 y nunca
  lanza.
- **Sección** = prefijo de ruta (`lib/usage/sections.ts`, con tests). Rutas
  nuevas del panel caen en `other` hasta que se añadan a `RULES`.
- **Lo que HACEN** se cuenta en las tablas de cada módulo, no en `audit_logs`
  (`lib/usage/report.ts`, una consulta `union all`): citas por origen (panel /
  asistentes / recuperadas), notas, WhatsApp equipo vs asistente, tareas
  manuales, facturas, cobros, consentimientos, finanzas, chat interno,
  enseñanzas. "Trabajo automatizado" = acciones de asistentes y huecos
  recuperados sobre el total.
- **Riesgo**: `inactive` (sin uso en 7 días), `dropping` (< 50 % del período
  anterior con ≥ 1 h antes), `never`. Futura y las archivadas no cuentan.
- ⚠️ En SQL crudo con postgres-js, las fechas van como string ISO con
  `::timestamptz`, no como `Date` (revienta), y `day` como alias necesita `as`.

## Revisión del asistente (sólo Futura)

`/dashboard/futura/asistente` (botón **Asistente** en Panel Futura). Cada
respuesta del asistente de WhatsApp de todas las clínicas (`whatsapp_agent_runs`
unido a sus mensajes), con lo que entró, las herramientas con sus argumentos y
resultado, lo que salió, y una **revisión automática** (`lib/agent-review/flags.ts`,
puro, con tests): error, sin respuesta, herramienta fallida o que no pudo
(resultado que empieza en negación), guardrails (de `intent_reasoning`),
lenta (> 20 s), "pide perdón o da la razón", "no me queda nada" en día
cerrado, tres o más preguntas, muy larga, la familia se queja. Filtros por
URL (`horas`, `clinica`, `solo=todo`). Nació el 6/11 para ver los fallos antes
que la clínica; un aviso que se dispara mucho sin ser fallo se afina ahí. El
enlace al chat sólo funciona gestionando esa clínica. Las consultas SQL de
diagnóstico ya no hacen falta para esto; para lo demás, Dokploy →
cliniq-postgres → Terminal → `psql -U cliniq cliniq`.

## Consulta de diagnóstico de solo lectura (`/api/internal/diagnostico`)

Para diagnosticar producción sin abrir el puerto de Postgres ni SSH (desde las
sesiones en la nube sólo llegan los puertos 80/443). `POST` con cabecera
`x-diagnostic-token` y `{ "query": "select …" }`. Se activa SÓLO si el
servicio `cliniq-web` tiene `DIAGNOSTIC_TOKEN` (32+ caracteres) en su entorno
de Dokploy; sin ella responde 404. Una sola sentencia `SELECT`/`WITH`
(`guardDiagnosticQuery`, `lib/diagnostics/sql-guard.ts`, con tests), dentro de
una transacción `READ ONLY` con tope de 15 s y 500 filas. El log guarda la
huella de la consulta, nunca el texto ni las filas. Para cerrarla: borrar la
variable y reiniciar el servicio. Devuelve datos de pacientes: no pegar sus
resultados en el repo.

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
5. **Saldo de Zadarma** (PBX 569854, trunk `569854-100` detrás del +34919932263). El 2026-09-11 estaba a cero: la centralita contesta con la locución "no hay fondos suficientes", Retell la da por conectada (`ended`/`agent_hangup`, ~16 s) y `triggerCallback` devuelve `ok`, así que la app dice "te estamos llamando" y nadie recibe nada. Ante cualquier "no me llama", mirar primero la transcripción en Retell de producción: si el "user" es una locución de Zadarma, es saldo, no código. Recargar y comprobar en cabinet el historial del 5 y 7 de septiembre (fraude IRSF por la demo pública). El `dial_no_answer` de mayo era otro problema.
6. ⚠️ **Repegar las URLs de los webhooks de GHL con su token.** Los webhooks de GoHighLevel ahora exigen un token por tenant y rechazan con 401 sin él. Al primer intento fallido, el contenedor loguea la URL exacta a configurar (`[ghl-webhook] token inválido o ausente ... Configurá esta URL en GHL: ...`). Va en GHL → Settings → Integrations → Webhooks, para los dos endpoints (`/contact` y `/appointment`).
7. **Reconectar las instancias de Evolution.** El webhook de Evolution también lleva token; se registra solo al crear o reconectar la instancia desde el panel, pero las instancias ya existentes siguen apuntando a la URL vieja y devolverán 401. Reconectarlas desde `/dashboard/whatsapp/integrations`.
8. **Confirmar la persistencia de Redis en Dokploy** (AOF o RDB en `cliniq-redis`). Los `reminder-send` son jobs *delayed* y viven sólo en Redis: sin persistencia, un reinicio los borra. Ya hay una red de seguridad (`reconcileOverdueReminders`, dentro del barrido diario) que re-encola los `SCHEDULED` vencidos, pero es una red, no un sustituto.
9. Rotar `ENCRYPTION_KEY` invalida los tokens de webhook (se derivan de ella) — hay que repetir los pasos 6 y 7 después de rotarla.

## Seguridad: invariantes que no se negocian

Escrito después de una auditoría que encontró varias de estas rotas. Antes de tocar estas zonas, leer esto.

- **Todo webhook público verifica antes de tocar la BD.** Los proveedores que firman (Clerk/svix, Retell, Twilio, Meta Cloud, Zadarma) se validan con su firma; los que no firman (GHL, Evolution) exigen el token por tenant de `lib/webhooks/tenant-token.ts`. Un identificador que manda el propio emisor (`locationId`, `instance`) NO es autenticación: es público o adivinable.
- **La verificación de firma nunca es condicional.** Un `if (signature) { ...verificar... }` se salta omitiendo el campo. Si el tenant tiene secret, la firma es obligatoria.
- **Los gates de rol normalizan antes de comparar.** Clerk guarda `member` / `org:admin`, no nuestros tres roles. Comparar el valor crudo contra la tabla de orden da `undefined < 2` → `false` y deja pasar a cualquiera. Usar siempre `normalizeRole()` de `lib/tasks/auth.ts`.
- **El rol se resuelve en un solo sitio: `resolveTenantRole()` (`lib/auth/tenant-role.ts`).** Futura (super-admin) es `admin` en cualquier clínica que gestione aunque no tenga fila en `tenant_memberships`; los gates de tareas, mensajes, recordatorios, lista de espera y agenda, y las páginas que pintan la UI por rol, pasan por ahí. Un gate nuevo que consulte `tenant_memberships` por su cuenta vuelve a dejar a Futura como `viewer` (es lo que impedía probar los asistentes de una clínica desde el modo Futura).
- **Esconder un botón no protege nada.** Toda ruta y toda Server Action que escriba valida el rol en el servidor (`denyUnlessRole()` de `lib/auth/api-guard.ts`).
- **Toda query lleva `tenant_id` en el `WHERE`**, lecturas y escrituras, incluso cuando el id viene de una fila ya validada. Es defensa en profundidad y además es lo que hace que se usen los índices, que lideran por `tenant_id`.
- **Los ids de usuario que llegan del cliente se validan contra la membresía del tenant** antes de darles acceso a nada (`upsertMembers` en `lib/messaging/channels.ts`). El fan-out de realtime publica a `im:user:<id>` sin tenant en la clave.
- **Los datos de paciente no van a los logs.** Los payloads de webhook se guardan con `redactWebhookPayload()`: la transcripción y la grabación se cifran en `calls`, volcarlas en claro en `webhook_logs` anula ese cifrado.
- **Todo endpoint público que gasta dinero lleva rate-limit por IP y tope global** (`lib/queue/rate-limit.ts`). Un límite por número de teléfono no sirve: se rotan números.
- **La demo pública sólo marca a la lista blanca de países** (`lib/calls/destination-allowlist.ts`, env `FUTURA_DEMO_ALLOWED_COUNTRY_CODES`, defecto ES/AR/UY/MX/CL/CO/PE). El rate-limit no frena el fraude IRSF: el 5 y 7 de septiembre de 2026 una ráfaga de `landing_demo` a Serbia, Kenia, Israel, Sri Lanka… vació el saldo de Zadarma y desde entonces la demo "conectaba" con la locución de "sin fondos" mientras la landing decía "te estamos llamando". No hay valor "todos": una variable vacía o inválida cae al defecto. Si se añade `1`, se abre también el Caribe.

## Colas: invariantes

- **Un `wa-process` que falla en todos los intentos no puede quedar en
  silencio** (`onWhatsappJobGaveUp`, enganchado al `failed` del worker en el
  último intento): guarda el run con el error (sale en «Revisión del
  asistente») y avisa al equipo como un traspaso (tarea + tarjeta). El 11/11
  una familia contestó a la pregunta de la fiebre y nadie le respondió en más
  de una hora: el job falló sin run y sólo quedó en el log. Al paciente no se
  le manda nada automático.

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
- **`recharts` y todo lo pesado entran por `next/dynamic`** (`components/dashboard/charts-lazy.tsx`). Un gráfico que importe `recharts` directo se salta el corte y mete la librería en el bundle de su ruta, aunque nadie mire esa pestaña.
- **Toda navegación da señal antes de que conteste el servidor.** Los enlaces
  del menú y las pestañas usan `NavLink` de `components/dashboard/nav-progress.tsx`,
  que pinta la barra de arriba y marca el ítem pulsado con `useLinkStatus`. Con
  todo el panel en `force-dynamic`, un `<Link>` pelado deja la pantalla idéntica
  cientos de milisegundos: se lee como que el clic no registró y la gente vuelve
  a pulsar, encolando otra navegación.
- **`experimental.staleTimes.dynamic` está en 30 en `next.config.ts`.** El
  default de Next 15 es 0 y el panel es todo dinámico: sin esto, volver a una
  sección recién visitada o pulsar «atrás» re-ejecuta el layout entero en el
  servidor. Si alguien lo quita, vuelve el «se tilda» al cambiar de sección.
- **El layout del panel es camino crítico de TODA página.** Envuelve sidebar,
  topbar y el contenido, así que hasta que termina no sale nada hacia el
  navegador, ni siquiera el `loading.tsx` de la ruta destino. Todo lo que no
  dependa de otra cosa va en la misma tanda (`Promise.all`); un `await` nuevo
  encadenado ahí se paga en cada navegación Y en cada `router.refresh()`.
- **Lo que se pide más de una vez por petición va en `cache()` de React**
  (`getCurrentTenant`, `resolveTenantRole`, `findProfessionalForClerkUser`,
  `internalUserIdFor`). Un gate nuevo que consulte por su cuenta vuelve a
  sumar round-trips idénticos al camino crítico.
- **Un listado nunca trae columnas que no pinta.** `listCalls` seleccionaba
  `SELECT *` y arrastraba `transcript_enc` —la transcripción entera, cifrada—
  en el listado de 100 filas sólo para tirarla.
- **Un contador es `COUNT(*)`**, no traer las filas y medir el array.
- **El escalonado de listas (`.stagger`) está capado a 300 ms en el CSS.** El
  tope vive en `animation-delay: min(...)` de `globals.css`, no en cada lista:
  la mitad de los usos a mano no capaban el índice y el elemento 14 aparecía
  840 ms tarde. Eso es contenido real retrasado, no decoración.
- **Nada que sondee corre con la pestaña en segundo plano.** Todo `setInterval`
  del panel comprueba `document.visibilityState`.

## Llamadas externas: el invariante que más se incumplía

**Toda llamada a un proveedor lleva `AbortSignal.timeout`.** Está escrito arriba
en «Colas: invariantes» desde siempre, y en septiembre de 2026 no lo cumplía
ninguno de los diez clientes HTTP del repo. Un proveedor que acepta la conexión
y no responde:

- cuelga el request de Node hasta el timeout del runtime (minutos), en el MISMO
  proceso que sirve el panel — de ahí buena parte del «se tilda»;
- o inmoviliza un slot del worker para siempre, porque BullMQ renueva el lock
  mientras el handler sigue vivo y el job nunca se marca stalled. El único modo
  de recuperar ese slot era un redeploy.

Ya lo llevan `lib/{openai,ghl,zadarma,twilio,logger}`, `lib/ghl/oauth.ts`,
`lib/whatsapp/{cloud,twilio,evolution}.ts`, `lib/whatsapp/agent/vision.ts` y el
proxy de grabaciones. **Un cliente nuevo sin tope es un bug, no un descuido.**

**Y ningún webhook público llama a un LLM antes de contestar.** El de Retell
resumía con el LLM antes del ack del evento más frecuente de la centralita, y
encima el job `process-call` ya resumía y pisaba el resultado: dos llamadas a un
LLM por llamada telefónica, una bloqueando. Ese trabajo va a la cola.

---

**Última actualización**: 2026-11-12 (salud del canal de WhatsApp tras la caída de Evolution: no anular sin canal fiable, mensajes tardíos, lote por disparador, avisos). Anterior: 2026-11-10 (bloque 2 de Respinens). Anterior: 2026-09-25 (auditoría de rendimiento con agentes: señal de navegación, caché del router, camino crítico del layout, topes de espera en los diez clientes externos, consultas encadenadas, índices de la migración 0044 y CI en verde).
