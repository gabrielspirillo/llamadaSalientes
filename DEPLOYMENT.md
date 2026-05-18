# Despliegue en Dokploy — Paso a paso

Guía operativa para levantar el stack completo en el servidor `72.60.212.232`
(Dokploy `v0.28.8`, UI en `https://vpsdokploy.futuradigital.es`).

> **Asunción**: ya están los DNS `app.`, `minio.`, `s3.futuradigital.es` →
> `72.60.212.232`. Si no, hacelo antes (registrar A records).

## Resumen del stack final

Cinco servicios visibles en la UI de Dokploy, agrupados en **un mismo
Project** (`futura-cliniq`):

| Servicio          | Tipo Dokploy   | Imagen                  | Puerto interno | Dominio público                     |
|-------------------|----------------|-------------------------|----------------|-------------------------------------|
| `cliniq-postgres` | Database       | postgres:16             | 5432           | — (solo red interna)                |
| `cliniq-redis`    | Database       | redis:7                 | 6379           | — (solo red interna)                |
| `cliniq-minio`    | Application    | minio/minio:latest      | 9000 / 9001    | `s3.futuradigital.es` + `minio.futuradigital.es` |
| `cliniq-web`      | Application    | Dockerfile.web (Git)    | 3000           | `app.futuradigital.es`              |
| `cliniq-worker`   | Application    | Dockerfile.worker (Git) | —              | — (sin HTTP)                        |

---

## 0. Limpieza del intento anterior

Antes de empezar, eliminar el deployment stub `web-futura-cliniq` que dejó
nginx vacío + Postgres sin tablas:

1. Dokploy UI → buscar el Project que contiene `web-futura-cliniq`.
2. Para CADA service de ese project: **Settings → Delete service**.
3. Eliminar el Project si queda vacío.

(Alternativamente desde SSH: `docker service rm web-futura-cliniq-web-... web-futura-cliniq-bbdd-...` — pero hacelo desde la UI para que la BD interna de Dokploy se mantenga consistente.)

---

## 1. Crear el Project

Dokploy UI → **Projects → Create Project**:

- **Name**: `futura-cliniq`
- **Description**: `Producción de la app SaaS de voice + WhatsApp`

---

## 2. Postgres (database)

Dentro del project → **Add Service → Database → Postgres**.

| Campo            | Valor                          |
|------------------|--------------------------------|
| Service name     | `cliniq-postgres`              |
| Docker image     | `postgres:16`                  |
| Database name    | `cliniq`                       |
| Database user    | `cliniq`                       |
| Password         | (generar uno fuerte y guardar) |
| External port    | dejar vacío (no exponer fuera) |

**Deploy** → esperar que quede en *Running*. Anotar la connection string que
muestra Dokploy: `postgres://cliniq:<pwd>@cliniq-postgres:5432/cliniq`.

### Aplicar el schema

Una vez running, conectar y aplicar las migraciones:

```bash
ssh root@72.60.212.232

# Clonar el repo temporalmente (o subir el dir migrations).
git clone https://github.com/<tu-org>/llamadaSalientes /tmp/cliniq-repo

# Aplicar las 10 migraciones SQL en orden.
docker run --rm \
  --network=dokploy-network \
  -v /tmp/cliniq-repo/supabase/migrations:/migrations:ro \
  postgres:16 \
  bash -c 'for f in /migrations/*.sql; do echo "-- $f --"; psql "postgres://cliniq:<PWD>@cliniq-postgres:5432/cliniq" -v ON_ERROR_STOP=1 -f "$f"; done'
```

> Reemplazá `<PWD>` por el password que generaste. Si vas a hacer la migración
> de datos (paso 7), saltá este apply de migrations — el `pg_dump` ya las
> trae embebidas.

---

## 3. Redis (database)

**Add Service → Database → Redis**.

| Campo         | Valor                            |
|---------------|----------------------------------|
| Service name  | `cliniq-redis`                   |
| Docker image  | `redis:7`                        |
| Password      | (generar uno y guardar, opcional pero recomendado) |
| External port | vacío                            |

Connection string: `redis://default:<pwd>@cliniq-redis:6379` (o sin password si no setteaste).

---

## 4. MinIO (application)

MinIO no está en el menú "Database" de Dokploy, así que se crea como
**Application** apuntando a la imagen Docker pública.

**Add Service → Application → Docker image**:

| Campo         | Valor                              |
|---------------|------------------------------------|
| Service name  | `cliniq-minio`                     |
| Docker image  | `minio/minio:latest`               |
| Command       | `server /data --console-address ":9001"` |
| Volumes       | `/data` → mantener (Dokploy crea volume) |

**Environment**:

```
MINIO_ROOT_USER=futuraadmin
MINIO_ROOT_PASSWORD=<generar uno fuerte>
MINIO_BROWSER_REDIRECT_URL=https://minio.futuradigital.es
```

**Domains** (Traefik) — añadir DOS:

1. Para la API S3:
   - Host: `s3.futuradigital.es`
   - Container port: `9000`
   - SSL: Let's Encrypt — ON
2. Para la consola:
   - Host: `minio.futuradigital.es`
   - Container port: `9001`
   - SSL: Let's Encrypt — ON

**Deploy**. Una vez running:

1. Entrar a `https://minio.futuradigital.es` con `futuraadmin` / `<pwd>`.
2. Crear bucket: `Buckets → Create Bucket → whatsapp-media`.
3. Hacer el bucket público para lectura:
   - Click en `whatsapp-media` → **Anonymous → Add Access Rule**
   - Prefix: `*`
   - Access: `readonly`
4. Crear access key específica para la app (no usar root):
   - **Access Keys → Create**
   - Anotar `Access Key` y `Secret Key`.

---

## 5. App Next.js (application)

Necesitás conectar Dokploy a GitHub primero:

1. **Dokploy UI → Settings → Git** → conectar GitHub (OAuth o token con permiso de repo).

Luego:

**Add Service → Application → Git**:

| Campo                | Valor                             |
|----------------------|-----------------------------------|
| Service name         | `cliniq-web`                      |
| Repository           | tu org / `llamadaSalientes`       |
| Branch               | `main`                            |
| Build type           | **Dockerfile**                    |
| Dockerfile path      | `Dockerfile.web`                  |
| Build context        | `.` (raíz)                        |
| Build target stage   | (vacío — usa el último: `runner`) |
| Watch paths          | `apps/web/**`, `packages/**`, `pnpm-lock.yaml` |

### Build Arguments (necesarios para que `next build` no falle)

Las vars `NEXT_PUBLIC_*` se embeben en el bundle al build, y Clerk valida
sus claves al prerenderizar. Setealas como **Build Args** (no env runtime):

```
NEXT_PUBLIC_APP_URL=https://app.futuradigital.es
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
CLERK_SECRET_KEY=sk_live_...
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...
DATABASE_URL=postgres://cliniq:<pwd>@cliniq-postgres:5432/cliniq
DIRECT_URL=postgres://cliniq:<pwd>@cliniq-postgres:5432/cliniq
ENCRYPTION_KEY=<openssl rand -base64 32>
```

### Environment (runtime)

Copiá ABSOLUTAMENTE TODAS las vars de tu producción actual (Vercel) + las
nuevas del stack self-hosted:

```
# App
NEXT_PUBLIC_APP_URL=https://app.futuradigital.es
NODE_ENV=production

# DB (interno a la red Dokploy)
DATABASE_URL=postgres://cliniq:<pwd>@cliniq-postgres:5432/cliniq
DIRECT_URL=postgres://cliniq:<pwd>@cliniq-postgres:5432/cliniq

# Clerk
CLERK_SECRET_KEY=sk_live_...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...

# Queue (Redis interno)
REDIS_URL=redis://default:<pwd>@cliniq-redis:6379

# Storage S3/MinIO (interno + público para URLs)
S3_ENDPOINT=http://cliniq-minio:9000
S3_PUBLIC_BASE_URL=https://s3.futuradigital.es
S3_REGION=us-east-1
S3_ACCESS_KEY=<access key creada en MinIO console>
S3_SECRET_KEY=<secret>
S3_BUCKET_WHATSAPP=whatsapp-media
S3_FORCE_PATH_STYLE=true

# R2 (recordings de Retell — se mantiene Cloudflare)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...

# Crypto
ENCRYPTION_KEY=<el MISMO que usaste en Build Args>

# Twilio
TWILIO_ACCOUNT_SID=...
TWILIO_API_KEY=...
TWILIO_API_SECRET=...

# Retell
RETELL_API_KEY=...
RETELL_WEBHOOK_SIGNING_KEY=...
RETELL_DEFAULT_AGENT_ID=...
RETELL_OUTBOUND_DEFAULT_AGENT_ID=...
RETELL_SIP_DOMAIN=5t4n6j0wnrl.sip.livekit.cloud

# GHL
GHL_CLIENT_ID=...
GHL_CLIENT_SECRET=...
GHL_REDIRECT_URI=https://app.futuradigital.es/api/ghl/callback
GHL_WEBHOOK_PUBLIC_KEY=...

# AI providers
OPENAI_API_KEY=...
OPENAI_TRANSCRIBE_MODEL=whisper-1
OPENAI_AGENT_FALLBACK_MODEL=gpt-4o-mini
GEMINI_API_KEY=...
GEMINI_VISION_MODEL=gemini-flash-latest
GEMINI_AGENT_MODEL=gemini-flash-latest

# Feature flags
WHATSAPP_AGENT_ENABLED=true

# Demo / public landing (opcional)
FUTURA_DEMO_TENANT_ID=...
FUTURA_DEMO_ALLOWED_ORIGINS=https://cliniq.futuradigital.es
FUTURA_DEMO_RETELL_AGENT_ID=agent_b7c4de5748c40e118d193db2f6

# Observability (opcional)
SENTRY_DSN=...
AXIOM_TOKEN=...
AXIOM_DATASET=...
```

### Domains

Añadir UN dominio:

- Host: `app.futuradigital.es`
- Container port: `3000`
- SSL: Let's Encrypt — ON
- Redirect HTTP → HTTPS: ON

### Health check (opcional pero recomendado)

- Path: `/api/health`
- Interval: `30s`
- Initial delay: `60s` (Next 15 tarda en arrancar)

### Deploy

Click **Deploy**. Seguí los logs (tab Logs) — el primer build tarda
~3-5 min. Cuando termine:

```bash
curl -fsS https://app.futuradigital.es/api/health && echo OK
```

---

## 6. Worker (application)

**Add Service → Application → Git**:

| Campo            | Valor                  |
|------------------|------------------------|
| Service name     | `cliniq-worker`        |
| Repository       | mismo repo             |
| Branch           | `main`                 |
| Build type       | Dockerfile             |
| Dockerfile path  | `Dockerfile.worker`    |
| Build context    | `.`                    |
| Watch paths      | `apps/web/lib/**`, `apps/web/worker/**`, `packages/**`, `pnpm-lock.yaml` |

### Environment

**Copiar las MISMAS env vars del cliniq-web** (mismo DATABASE_URL, REDIS_URL,
S3_*, Twilio, Retell, OpenAI, Gemini, R2, etc.). El worker es un consumidor
del mismo lado del servidor que la app web — comparte secrets.

**No necesita** `NEXT_PUBLIC_*` ni `CLERK_*` (no expone HTTP ni sirve UI).

### Domains

Ninguno. El worker no expone HTTP.

### Deploy

Click **Deploy**. Una vez running, validar:

```bash
ssh root@72.60.212.232 'docker logs --tail 50 $(docker ps -q -f name=cliniq-worker)'
# Debería mostrar: [worker] booting + [worker] ready
```

---

## 7. Migración de datos (Postgres + Storage)

Si querés traerte los datos de Supabase, seguí
[`scripts/migrate/README.md`](scripts/migrate/README.md). Resumen:

1. Local: `bash scripts/migrate/01-dump-supabase.sh` → `dumps/supabase-dump-*.sql`.
2. `scp` el dump al servidor.
3. SSH + `bash 02-restore-postgres.sh`.
4. Local: `tsx scripts/migrate/03-copy-storage.ts` (descarga Supabase Storage → sube a MinIO).

> Si ya aplicaste las migraciones SQL en el paso 2 y vas a hacer pg_dump,
> primero **vaciá** las tablas (`TRUNCATE`) o saltá el `db:push` inicial.

---

## 8. Apuntar webhooks externos al nuevo dominio

Ver sección "4. Reconfigurar webhooks externos" de `scripts/migrate/README.md`.
Servicios a actualizar: Clerk, Twilio, Meta Cloud, Retell, GHL, Stripe.

---

## 9. Validación end-to-end

```bash
# 1. App responde
curl -fsS https://app.futuradigital.es/api/health

# 2. MinIO accesible
curl -fsS https://s3.futuradigital.es/whatsapp-media/  # 403 listings OK si el bucket es público read-only

# 3. Worker procesa jobs (test: mandar un WhatsApp a tu número Twilio).
ssh root@72.60.212.232 'docker logs --tail 20 -f $(docker ps -q -f name=cliniq-worker)'

# 4. Conectarse a Postgres y ver tablas
ssh root@72.60.212.232 'docker run --rm --network=dokploy-network postgres:16 psql "postgres://cliniq:<pwd>@cliniq-postgres:5432/cliniq" -c "\dt"'

# 5. Conectarse a Redis y ver queues
ssh root@72.60.212.232 'docker run --rm --network=dokploy-network redis:7 redis-cli -h cliniq-redis -a "<pwd>" KEYS "bull:*"'
```

---

## Troubleshooting rápido

| Síntoma                                          | Diagnóstico                                                                             |
|--------------------------------------------------|----------------------------------------------------------------------------------------|
| Build falla en `next build` con error Clerk      | Falta una `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` válida en **Build Args** (no env runtime). |
| App levanta pero responde 500 en todo            | DB no alcanzable. Verificá DATABASE_URL apunta a `cliniq-postgres:5432` (no localhost). |
| Webhooks de WhatsApp llegan pero el bot no responde | (a) `REDIS_URL` mal en `cliniq-web` o `cliniq-worker`. (b) `WHATSAPP_AGENT_ENABLED` no es `true`. |
| Worker se cae inmediatamente                     | Logs en Dokploy. Suele ser `REDIS_URL` ausente o env Zod-invalid en `lib/env.ts`.       |
| Imágenes/audios de WhatsApp 404 en el inbox UI   | (a) Bucket no público. (b) `S3_PUBLIC_BASE_URL` mal o sin DNS.                          |
| Out-of-memory                                    | Server tiene 3.8GiB. Apagá el stack n8n si no lo usás, o subí la RAM del VPS.           |
