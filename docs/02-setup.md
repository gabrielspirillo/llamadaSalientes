# Guía de configuración — Entorno de desarrollo local

> Parte de la [Documentación para Desarrolladores](./README.md). Ver también: [Arquitectura](./01-arquitectura.md) · [Referencia de API](./03-api-referencia.md) · [Deployment](./04-deployment.md).

## 1. Requisitos previos

| Herramienta | Versión | Notas |
|---|---|---|
| Node.js | ≥ 20 | `engines` en `package.json` |
| pnpm | 9.15.0 | `corepack enable && corepack prepare pnpm@9.15.0 --activate` |
| Docker + Docker Compose | reciente | Para Postgres, Redis y MinIO locales |
| Cuenta Clerk | test keys | Auth obligatoria: la app no compila ni corre sin claves Clerk válidas |

Opcionales según lo que vayas a tocar: claves de Retell, Twilio, Zadarma, OpenAI, Gemini y una app OAuth de GoHighLevel (ver §5).

## 2. Clonar e instalar

```bash
# 1. Clonar
git clone https://github.com/gabrielspirillo/llamadaSalientes.git
cd llamadaSalientes

# 2. Instalar dependencias (workspace completo: apps/web + packages/*)
pnpm install
```

## 3. Levantar la infraestructura local (Postgres + Redis + MinIO)

El `docker-compose.yml` de la raíz replica el stack de producción:

```bash
docker compose up -d postgres redis minio minio-init
```

Esto levanta:

| Servicio | Puerto local | Credenciales default |
|---|---|---|
| Postgres 16 | `localhost:5432` | db `cliniq` / user `cliniq` / pass `changeme` (var `POSTGRES_PASSWORD`) |
| Redis 7 | `localhost:6379` | sin password |
| MinIO API | `localhost:9000` | `minioadmin` / `minioadmin` |
| MinIO Console | `localhost:9001` | ídem |

`minio-init` crea automáticamente el bucket `whatsapp-media` con lectura pública y termina. Si además vas a trabajar con grabaciones de llamadas, creá el bucket `retell-recordings` (privado) desde la consola en `http://localhost:9001`.

### Aplicar el schema de base de datos

Las migraciones SQL versionadas viven en `supabase/migrations/` (el nombre de la carpeta es histórico — se aplican al Postgres local/self-hosted, **no** a Supabase):

```bash
for f in supabase/migrations/*.sql; do
  echo "-- $f"
  docker exec -i cliniq-postgres psql -U cliniq -d cliniq -v ON_ERROR_STOP=1 < "$f"
done
```

Alternativa para desarrollo rápido (sincroniza el schema Drizzle sin migraciones):

```bash
pnpm --filter web db:push      # drizzle-kit push (solo dev)
pnpm --filter web db:studio    # UI para explorar la BD
```

## 4. Variables de entorno

```bash
cp .env.example .env.local
```

Mínimo imprescindible para levantar el dev server:

```bash
# App
NEXT_PUBLIC_APP_URL=http://localhost:3000

# BD (docker-compose local)
DATABASE_URL=postgres://cliniq:changeme@localhost:5432/cliniq
DIRECT_URL=postgres://cliniq:changeme@localhost:5432/cliniq

# Clerk (crear app en clerk.com → API Keys; habilitar Organizations)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...   # dashboard Clerk → Webhooks

# Cola
REDIS_URL=redis://localhost:6379

# Storage (MinIO local)
S3_ENDPOINT=http://localhost:9000
S3_PUBLIC_BASE_URL=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET_WHATSAPP=whatsapp-media
S3_FORCE_PATH_STYLE=true

# Cifrado de secretos por tenant
ENCRYPTION_KEY=$(openssl rand -base64 32)
```

`apps/web/lib/env.ts` valida todo con Zod al arrancar: si falta una variable requerida o tiene formato inválido, el proceso muere con un error explícito. El resto de claves (`RETELL_API_KEY`, `TWILIO_*`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GHL_*`…) solo hacen falta para los flujos que las usan — ver comentarios en `.env.example`.

> ⚠️ El agente IA de WhatsApp arranca **apagado** por seguridad (`WHATSAPP_AGENT_ENABLED=false`): los webhooks encolan el job pero el worker sale sin invocar al LLM. Ponelo en `true` solo cuando quieras probar el agente de punta a punta.

## 5. Levantar la app

```bash
# Dev server Next.js (frontend + API) en http://localhost:3000
pnpm dev

# En otra terminal: worker BullMQ (necesario para WhatsApp, post-procesado
# de llamadas, recordatorios y waitlist)
pnpm --filter web worker:dev
```

Verificación:

```bash
curl http://localhost:3000/api/health
# {"ok":true,"service":"dental-voice","timestamp":"..."}
```

Primer uso: registrate en `/sign-up`, creá una **organización** en Clerk (1 org = 1 tenant) y completá el onboarding. El webhook de Clerk (`/api/webhooks/clerk`) es el que crea la fila en `tenants` — en local necesitás exponer tu puerto con un túnel (ver §6) y apuntar el webhook de Clerk ahí, o insertar el tenant a mano en la BD.

### Alternativa: todo en Docker

```bash
docker compose up -d --build     # incluye web + worker con Dockerfile.web / Dockerfile.worker
```

Útil para reproducir el build de producción (standalone). Para desarrollo diario es más cómodo `pnpm dev` fuera de Docker.

## 6. Webhooks externos en local

Los proveedores (Retell, Twilio, Zadarma, Clerk, Meta) necesitan una URL pública. Usá un túnel:

```bash
ngrok http 3000      # o cloudflared tunnel --url http://localhost:3000
```

y apuntá los webhooks del proveedor a `https://<tunel>/api/webhooks/...` (rutas exactas en la [Referencia de API](./03-api-referencia.md)).

## 7. Comandos del día a día

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Dev server Next.js en :3000 |
| `pnpm --filter web worker:dev` | Worker BullMQ con hot-reload |
| `pnpm typecheck` | TypeScript estricto (`tsc --noEmit`) — correr antes de cada push |
| `pnpm test` | Vitest (hay 2 archivos pre-rotos no relacionados a la migración) |
| `pnpm test:e2e` | Playwright |
| `pnpm check` | Biome lint + format check |
| `pnpm format` | Biome auto-format |
| `pnpm build` | Build de producción (necesita env vars con shape Clerk válido) |
| `pnpm --filter web db:generate` | Genera migración Drizzle desde el schema |
| `pnpm --filter web db:studio` | Drizzle Studio (UI de BD) |
| `pnpm --filter web eval:agent` | Corre las evals del agente de WhatsApp |

## 8. Convenciones del repo

- **Idioma**: comentarios de código, commits y mensajes de UI en **español**.
- **Commits**: prefijos convencionales `feat:`, `fix:`, `refactor:`, `chore:`.
- **Branches**: `feat/…`, `fix/…`, `refactor/…`. `main` es productiva y **auto-deploya** a Dokploy con cada push (ver [Deployment](./04-deployment.md)).
- **TypeScript**: estricto con `noUncheckedIndexedAccess`; validar inputs con Zod.
- **Antes de pushear**: `pnpm typecheck && pnpm test && pnpm check`.

## 9. Problemas frecuentes

| Síntoma | Causa / solución |
|---|---|
| `next build` falla con error de Clerk | Las claves `NEXT_PUBLIC_CLERK_*`/`CLERK_SECRET_KEY` faltan o tienen shape inválido; Clerk las valida al prerender |
| El proceso muere al arrancar con error Zod | Falta una env var requerida — leer el mensaje de `lib/env.ts` |
| La app corre pero login redirige en loop | Organización Clerk sin tenant en BD: revisar webhook de Clerk o crear el tenant manualmente |
| Mensajes de WhatsApp no se procesan | Worker no corriendo, `REDIS_URL` mal, o `WHATSAPP_AGENT_ENABLED` ≠ `true` |
| Imágenes/audios de WhatsApp dan 404 | Bucket `whatsapp-media` no existe o no es público; `S3_PUBLIC_BASE_URL` mal |
