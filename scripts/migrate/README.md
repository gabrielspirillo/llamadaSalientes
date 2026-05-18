# Migración Supabase → Self-hosted (Dokploy)

Pasos para mover **datos** (Postgres + Storage) desde Supabase al nuevo
stack en el servidor de Dokploy. Hacé estos pasos **después** de tener los
servicios Postgres, Redis y MinIO levantados en Dokploy.

## 1. Dump del Postgres de Supabase

Necesitás `pg_dump` (incluido en `postgresql-client` o en el contenedor de
Postgres). Desde tu laptop / Codespace:

```bash
# La DIRECT URL (puerto 5432, no 6543). La encontrás en Supabase Dashboard →
# Project Settings → Database → Connection String (URI) → "Direct connection".
export SUPABASE_DIRECT_URL='postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'

bash scripts/migrate/01-dump-supabase.sh
# → genera dumps/supabase-dump-<timestamp>.sql
```

## 2. Restore en el Postgres self-hosted

```bash
# Subir el dump al servidor.
scp dumps/supabase-dump-*.sql root@72.60.212.232:/tmp/

# Conectar al servidor.
ssh root@72.60.212.232

# Conexión interna al Postgres en Dokploy. Username/password los seteaste
# al crear el service Postgres en la UI. El host es el nombre del service
# (ej. "cliniq-postgres") dentro de la red dokploy-network.
export DUMP_FILE=/tmp/supabase-dump-XXXXXXXX.sql
export TARGET_URL='postgres://cliniq:<password>@cliniq-postgres:5432/cliniq'

bash 02-restore-postgres.sh  # corre el script que ya subiste o ejecutalo inline
```

Verificación:

```bash
docker run --rm --network=dokploy-network postgres:16 \
  psql "$TARGET_URL" -c '\dt'
docker run --rm --network=dokploy-network postgres:16 \
  psql "$TARGET_URL" -c 'SELECT count(*) FROM tenants;'
```

## 3. Copia de Storage (WhatsApp media)

```bash
# Desde tu laptop (descarga de Supabase + sube a MinIO públicamente
# accesible vía s3.futuradigital.es):
export SUPABASE_URL='https://<ref>.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='ey...'
export SUPABASE_BUCKET=whatsapp-media

export S3_ENDPOINT='https://s3.futuradigital.es'
export S3_ACCESS_KEY='<minio-access-key>'   # creado en Dokploy MinIO console
export S3_SECRET_KEY='<minio-secret-key>'
export S3_BUCKET=whatsapp-media

tsx scripts/migrate/03-copy-storage.ts
```

El script es idempotente: si lo corrés 2 veces, los objetos ya existentes
se saltan (HEAD + comparación de tamaño).

## 4. Reconfigurar webhooks externos

Una vez la app esté corriendo en `https://app.futuradigital.es`, hay que
re-apuntar los webhooks de servicios externos:

- **Clerk** → Dashboard → Webhooks → cambiar URL de `cliniq.vercel.app/api/webhooks/clerk` a `app.futuradigital.es/api/webhooks/clerk`. Mismo `CLERK_WEBHOOK_SIGNING_SECRET`.
- **Twilio** → Console → Phone Numbers → cada número con WhatsApp: cambiar Messaging URL a `https://app.futuradigital.es/api/webhooks/whatsapp/twilio`.
- **Meta Cloud WhatsApp** → developers.facebook.com → tu app → WhatsApp → Configuration → Webhook URL: `https://app.futuradigital.es/api/webhooks/whatsapp/cloud`.
- **Retell** → app.retellai.com → Settings → Webhooks → `https://app.futuradigital.es/api/webhooks/retell`.
- **GoHighLevel** (si lo usás) → Marketplace App settings → Webhook URL: `https://app.futuradigital.es/api/webhooks/ghl/*`.
- **Stripe** (si lo usás) → Dashboard → Webhooks → re-crear o editar al nuevo dominio.

## 5. Smoke tests post-cutover

```bash
# Health endpoint.
curl -fsS https://app.futuradigital.es/api/health && echo OK

# Login (vía UI).
open https://app.futuradigital.es/sign-in

# Test webhook desde Twilio (mensaje WhatsApp de prueba al número).

# Verificar logs del worker (que el job se ejecute).
ssh root@72.60.212.232 'docker logs --tail 100 cliniq-worker'
```
