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

## Env vars del stack

Vars críticas y dónde se setean. Lista completa en `.env.example`.

**Build args** (necesarias también en build de Dokploy para `next build` no crashee al prerender Clerk):
- `NEXT_PUBLIC_APP_URL=https://app.futuradigital.es`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`
- `DATABASE_URL`, `DIRECT_URL`
- `ENCRYPTION_KEY`

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

Token API ya generado y guardado por el usuario. **No está en este repo** — pedirlo si se necesita usar la API.

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

## Idioma

Comentarios de código, commit messages y mensajes UI: **español**. (Existing code convention.) PR descriptions y CLAUDE.md pueden ir en español o inglés, lo que sea más claro.

## Cómo testear builds antes de pushear

```bash
pnpm --filter web typecheck         # rápido
pnpm --filter web test              # vitest (hay 2 archivos pre-rotos no relacionados a la migración)
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

---

**Última actualización**: 2026-05-26 (post-migración + setup Zadarma outbound).
